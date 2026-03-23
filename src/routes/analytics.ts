import { Hono } from "hono";
import { Env, getSessionFromReq, kvCache } from "../helpers";

const analytics = new Hono<{ Bindings: Env }>();

// GET /api/pages — list user's pages (no token exposed)
analytics.get("/pages", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { results } = await c.env.DB.prepare(
    "SELECT page_id, page_name, category, picture_url FROM user_pages WHERE user_fb_id = ?"
  ).bind(session.fb_id).all();
  const selectedPageId = await c.env.KV.get("fb_page_id");
  return c.json({
    pages: (results || []).map((p: any) => ({
      id: p.page_id,
      name: p.page_name,
      category: p.category || null,
      picture: p.picture_url || null,
      selected: p.page_id === selectedPageId,
    })),
  });
});

// GET /api/insights/:pageId
analytics.get("/insights/:pageId", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const pageId = c.req.param("pageId");
  const page = await c.env.DB.prepare(
    "SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, pageId).first<{ page_token: string }>();
  if (!page?.page_token) return c.json({ error: "Page not found" }, 404);
  try {
    const metrics = "page_views_total,page_post_engagements,page_actions_post_reactions_total,page_daily_follows";
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/insights?metric=${metrics}&period=day&access_token=${page.page_token}`);
    const data = await res.json() as any;
    if (data.error) return c.json({ error: data.error.message }, 400);
    return c.json({ ok: true, insights: data.data || [] });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// GET /api/activity
analytics.get("/activity", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  try {
    const search = c.req.query("q");
    const from = c.req.query("from");
    const to = c.req.query("to");
    const limit = Math.min(100, +(c.req.query("limit") || "50"));

    let query = "SELECT * FROM activity_logs WHERE user_fb_id = ?";
    const params: (string | number)[] = [session.fb_id];

    if (search) { query += " AND (action LIKE ? OR detail LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
    if (from) { query += " AND created_at >= ?"; params.push(from); }
    if (to) { query += " AND created_at <= ?"; params.push(to); }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ activities: results || [], total: (results || []).length });
  } catch {
    return c.json({ activities: [], total: 0 });
  }
});

// GET /api/activity/stats — today's summary counts
analytics.get("/activity/stats", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const today = new Date().toISOString().split("T")[0];

  const [postsToday, aiToday, scheduledToday, draftsToday] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM posts WHERE created_at >= ? AND (user_fb_id = ? OR user_fb_id IS NULL)").bind(today, session.fb_id).first<{count:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM activity_logs WHERE action LIKE '%ai%' AND created_at >= ? AND user_fb_id = ?").bind(today, session.fb_id).first<{count:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM scheduled_posts WHERE status = 'pending' AND user_fb_id = ?").bind(session.fb_id).first<{count:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM drafts WHERE user_fb_id = ?").bind(session.fb_id).first<{count:number}>(),
  ]);

  return c.json({
    today: today,
    posts_today: postsToday?.count || 0,
    ai_uses_today: aiToday?.count || 0,
    scheduled_pending: scheduledToday?.count || 0,
    drafts_count: draftsToday?.count || 0,
  });
});

// GET /api/activity/timeline — grouped by date for UI
analytics.get("/activity/timeline", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const days = Math.min(30, +(c.req.query("days") || "7"));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { results } = await c.env.DB.prepare(
    "SELECT date(created_at) as day, action, COUNT(*) as count FROM activity_logs WHERE user_fb_id = ? AND created_at >= ? GROUP BY day, action ORDER BY day DESC"
  ).bind(session.fb_id, since).all();

  // Group by day
  const timeline: Record<string, {day:string, actions:Record<string,number>}> = {};
  for (const r of results as any[]) {
    if (!timeline[r.day]) timeline[r.day] = { day: r.day, actions: {} };
    timeline[r.day].actions[r.action] = r.count;
  }

  return c.json({ timeline: Object.values(timeline), days });
});

// GET /api/analytics/performance
analytics.get("/analytics/performance", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { results: topPosts } = await c.env.DB.prepare(
    "SELECT *, (COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as engagement FROM posts WHERE status = 'posted' AND (user_fb_id = ? OR user_fb_id IS NULL) ORDER BY engagement DESC LIMIT 10"
  ).bind(session.fb_id).all();
  const { results: worstPosts } = await c.env.DB.prepare(
    "SELECT *, (COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as engagement FROM posts WHERE status = 'posted' AND (user_fb_id = ? OR user_fb_id IS NULL) ORDER BY engagement ASC LIMIT 5"
  ).bind(session.fb_id).all();
  const avg = await c.env.DB.prepare(
    "SELECT AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as total_posts, SUM(COALESCE(likes,0)) as total_likes, SUM(COALESCE(comments,0)) as total_comments, SUM(COALESCE(shares,0)) as total_shares FROM posts WHERE status = 'posted' AND (user_fb_id = ? OR user_fb_id IS NULL)"
  ).bind(session.fb_id).first<any>();
  return c.json({ top: topPosts, worst: worstPosts, summary: avg });
});

// GET /api/analytics/best-time
analytics.get("/analytics/best-time", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { results: byHour } = await c.env.DB.prepare(
    "SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as post_count FROM posts WHERE status = 'posted' GROUP BY hour ORDER BY avg_engagement DESC"
  ).all();
  const { results: byDay } = await c.env.DB.prepare(
    "SELECT CAST(strftime('%w', created_at) AS INTEGER) as day, AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as post_count FROM posts WHERE status = 'posted' GROUP BY day ORDER BY avg_engagement DESC"
  ).all();
  const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const bestHours = (byHour as any[]).slice(0, 3).map((h: any) => h.hour);
  const bestDays = (byDay as any[]).slice(0, 3).map((d: any) => dayNames[d.day]);
  const { results: heatmap } = await c.env.DB.prepare(
    "SELECT CAST(strftime('%w', created_at) AS INTEGER) as day, CAST(strftime('%H', created_at) AS INTEGER) as hour, AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as count FROM posts WHERE status = 'posted' GROUP BY day, hour"
  ).all();
  return c.json({
    best_hours: bestHours, best_days: bestDays, by_hour: byHour,
    by_day: (byDay as any[]).map((d: any) => ({ ...d, day_name: dayNames[d.day] })),
    heatmap,
    recommendation: bestHours.length > 0 && bestDays.length > 0
      ? "ควรโพสวัน" + bestDays[0] + " เวลา " + bestHours[0] + ":00 น."
      : "ยังไม่มีข้อมูลเพียงพอ โพสเพิ่มเพื่อวิเคราะห์",
  });
});

// POST /api/analytics/refresh
analytics.post("/analytics/refresh", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const targetPageId = await c.env.KV.get("fb_page_id");
  if (!targetPageId) return c.json({ error: "No page" }, 400);
  const page = await c.env.DB.prepare(
    "SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, targetPageId).first<{ page_token: string }>();
  if (!page?.page_token) return c.json({ error: "No token" }, 400);
  const { results: posts } = await c.env.DB.prepare(
    "SELECT id, fb_post_id FROM posts WHERE fb_post_id IS NOT NULL AND status = 'posted' ORDER BY created_at DESC LIMIT 20"
  ).all();
  let updated = 0;
  for (const post of posts as any[]) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${post.fb_post_id}?fields=likes.summary(true),comments.summary(true),shares&access_token=${page.page_token}`);
      const data: any = await res.json();
      if (!data.error) {
        await c.env.DB.prepare("UPDATE posts SET likes = ?, comments = ?, shares = ? WHERE id = ?")
          .bind(data.likes?.summary?.total_count || 0, data.comments?.summary?.total_count || 0, data.shares?.count || 0, post.id).run();
        updated++;
      }
    } catch {}
  }
  return c.json({ ok: true, updated, total: posts.length });
});

// POST /api/analytics/sync-posts — import posts from Facebook into DB + refresh engagement
analytics.post("/analytics/sync-posts", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { page_id } = await c.req.json();
  if (!page_id) return c.json({ error: "page_id required" }, 400);
  const page = await c.env.DB.prepare(
    "SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, page_id).first<{ page_token: string }>();
  if (!page?.page_token) return c.json({ error: "Page not found" }, 404);

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${page_id}/posts?fields=id,message,created_time,likes.summary(true),comments.summary(true),shares&limit=50&access_token=${page.page_token}`);
    const data: any = await res.json();
    if (data.error) return c.json({ error: data.error.message }, 400);

    let imported = 0, updated = 0;
    for (const p of (data.data || [])) {
      const fbId = p.id;
      const existing = await c.env.DB.prepare("SELECT id FROM posts WHERE fb_post_id = ?").bind(fbId).first();
      const likes = p.likes?.summary?.total_count || 0;
      const comments = p.comments?.summary?.total_count || 0;
      const shares = p.shares?.count || 0;
      if (existing) {
        await c.env.DB.prepare("UPDATE posts SET likes = ?, comments = ?, shares = ? WHERE id = ?")
          .bind(likes, comments, shares, (existing as any).id).run();
        updated++;
      } else {
        await c.env.DB.prepare(
          "INSERT INTO posts (message, fb_post_id, page_id, user_fb_id, likes, comments, shares, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?)"
        ).bind(p.message || "", fbId, page_id, session.fb_id, likes, comments, shares, p.created_time || new Date().toISOString()).run();
        imported++;
      }
    }
    return c.json({ ok: true, imported, updated, total: (data.data || []).length });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// GET /api/insights-bundle/:pageId — all dashboard data in 1 request, cached 5 min
analytics.get("/insights-bundle/:pageId", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const pageId = c.req.param("pageId");

  const page = await c.env.DB.prepare(
    "SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, pageId).first<{ page_token: string }>();
  if (!page?.page_token) return c.json({ error: "Page not found" }, 404);

  try {
    const data = await kvCache(c.env.KV, `insights:${pageId}:v3`, 180, async () => {
      const [insights, performance, bestTime, stats] = await Promise.all([
        fetchInsights(pageId, page.page_token),
        fetchPerformance(c.env.DB, pageId),
        fetchBestTime(c.env.DB, pageId),
        fetchStats(c.env.DB, session.fb_id, pageId),
      ]);
      return { insights, performance, bestTime, stats, ts: new Date().toISOString() };
    });
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

async function fetchInsights(pageId: string, token: string) {
  try {
    const metrics = "page_views_total,page_post_engagements,page_actions_post_reactions_total,page_daily_follows";
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/insights?metric=${metrics}&period=day&access_token=${token}`);
    const data: any = await res.json();
    if (data.error) return { error: data.error.message, code: data.error.code };
    return (data.data || []).map((m: any) => ({ name: m.name, values: m.values?.slice(-7) }));
  } catch (e: any) { return { error: e.message }; }
}

async function fetchPerformance(db: D1Database, pageId: string) {
  const [top, avg] = await Promise.all([
    db.prepare("SELECT id, message, fb_post_id, page_id, (COALESCE(likes,0)+COALESCE(comments,0)+COALESCE(shares,0)) as eng, likes, comments, shares, created_at FROM posts WHERE status='posted' AND page_id=? ORDER BY eng DESC LIMIT 5").bind(pageId).all(),
    db.prepare("SELECT AVG(COALESCE(likes,0)+COALESCE(comments,0)+COALESCE(shares,0)) as avg_eng, COUNT(*) as total, SUM(COALESCE(likes,0)) as likes, SUM(COALESCE(comments,0)) as comments, SUM(COALESCE(shares,0)) as shares FROM posts WHERE status='posted' AND page_id=?").bind(pageId).first<any>(),
  ]);
  return { top: top.results, avg_eng: avg?.avg_eng || 0, total: avg?.total || 0, likes: avg?.likes || 0, comments: avg?.comments || 0, shares: avg?.shares || 0 };
}

async function fetchBestTime(db: D1Database, pageId: string) {
  const { results } = await db.prepare(
    "SELECT CAST(strftime('%w',created_at) AS INTEGER) as d, CAST(strftime('%H',created_at) AS INTEGER) as h, AVG(COALESCE(likes,0)+COALESCE(comments,0)+COALESCE(shares,0)) as eng, COUNT(*) as n FROM posts WHERE status='posted' AND page_id=? GROUP BY d,h"
  ).bind(pageId).all();
  const days = ['อา','จ','อ','พ','พฤ','ศ','ส'];
  const heatmap = results as any[];
  const bestSlot = heatmap.sort((a: any, b: any) => b.eng - a.eng)[0];
  return {
    heatmap: heatmap.map((r: any) => ({ d: r.d, h: r.h, eng: r.eng, n: r.n })),
    tip: bestSlot ? `โพสวัน${days[bestSlot.d]} ${bestSlot.h}:00 น.` : null,
  };
}

async function fetchStats(db: D1Database, fbId: string, pageId: string) {
  const today = new Date().toISOString().split("T")[0];
  const [posts, ai, sched, drafts] = await Promise.all([
    db.prepare("SELECT COUNT(*) as c FROM posts WHERE created_at>=? AND page_id=?").bind(today, pageId).first<{c:number}>(),
    db.prepare("SELECT COUNT(*) as c FROM activity_logs WHERE action LIKE '%ai%' AND created_at>=? AND user_fb_id=?").bind(today, fbId).first<{c:number}>(),
    db.prepare("SELECT COUNT(*) as c FROM scheduled_posts WHERE status='pending' AND user_fb_id=? AND page_id=?").bind(fbId, pageId).first<{c:number}>(),
    db.prepare("SELECT COUNT(*) as c FROM drafts WHERE user_fb_id=?").bind(fbId).first<{c:number}>(),
  ]);
  return { posts: posts?.c || 0, ai: ai?.c || 0, sched: sched?.c || 0, drafts: drafts?.c || 0 };
}

// Cron: auto-refresh engagement for all pages
export async function refreshAllEngagement(env: Env) {
  const { results: pages } = await env.DB.prepare(
    "SELECT page_id, page_token, user_fb_id FROM user_pages WHERE page_token IS NOT NULL"
  ).all();
  let total = 0, synced = 0;
  for (const pg of pages as any[]) {
    // Sync posts from FB into DB
    try {
      const syncRes = await fetch(`https://graph.facebook.com/v21.0/${pg.page_id}/posts?fields=id,message,created_time,likes.summary(true),comments.summary(true),shares&limit=20&access_token=${pg.page_token}`);
      const syncData: any = await syncRes.json();
      if (!syncData.error) {
        for (const p of (syncData.data || [])) {
          const existing = await env.DB.prepare("SELECT id FROM posts WHERE fb_post_id = ?").bind(p.id).first();
          const likes = p.likes?.summary?.total_count || 0;
          const comments = p.comments?.summary?.total_count || 0;
          const shares = p.shares?.count || 0;
          if (existing) {
            await env.DB.prepare("UPDATE posts SET likes = ?, comments = ?, shares = ? WHERE id = ?")
              .bind(likes, comments, shares, (existing as any).id).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO posts (message, fb_post_id, page_id, user_fb_id, likes, comments, shares, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?)"
            ).bind(p.message || "", p.id, pg.page_id, pg.user_fb_id, likes, comments, shares, p.created_time || new Date().toISOString()).run();
            synced++;
          }
          total++;
        }
      }
    } catch {}
  }
  console.log(`[cron] synced ${synced} new posts, refreshed ${total} total`);
}

export default analytics;
