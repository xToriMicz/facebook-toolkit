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
    if (data.error) return [];
    return (data.data || []).map((m: any) => ({
      name: m.name,
      values: (m.values || []).slice(-7).map((v: any) => ({
        value: typeof v.value === 'object' ? Object.values(v.value as Record<string, number>).reduce((a: number, b: number) => a + b, 0) : (v.value || 0),
        end_time: v.end_time,
      })),
    }));
  } catch { return []; }
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

// GET /api/challenges/:pageId — progress vs targets (7-day)
analytics.get("/challenges/:pageId", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const pageId = c.req.param("pageId");

  const page = await c.env.DB.prepare(
    "SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, pageId).first<{ page_token: string }>();
  if (!page?.page_token) return c.json({ error: "Page not found" }, 404);

  try {
    const data = await kvCache(c.env.KV, `challenges:${pageId}:v1`, 180, async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

      const [fbMetrics, postCount, reelCount] = await Promise.all([
        fetchChallengeMetrics(pageId, page.page_token, since),
        c.env.DB.prepare("SELECT COUNT(*) as c FROM posts WHERE page_id = ? AND created_at >= ? AND status = 'posted'").bind(pageId, since).first<{ c: number }>(),
        c.env.DB.prepare("SELECT COUNT(*) as c FROM posts WHERE page_id = ? AND created_at >= ? AND status = 'posted' AND post_type = 'reel'").bind(pageId, since).first<{ c: number }>(),
      ]);

      const targets = { follows: 100, posts: 10, reels: 3, engagements: 500, views: 1000 };

      const challenges = [
        { id: "follows", name: "ผู้ติดตามใหม่", icon: "👥", current: fbMetrics.follows, target: targets.follows },
        { id: "posts", name: "สร้างโพสต์", icon: "📝", current: postCount?.c || 0, target: targets.posts },
        { id: "reels", name: "สร้าง Reels", icon: "🎬", current: reelCount?.c || 0, target: targets.reels },
        { id: "engagements", name: "ได้โต้ตอบ", icon: "❤️", current: fbMetrics.engagements, target: targets.engagements },
        { id: "views", name: "เพิ่มยอดดู", icon: "👁️", current: fbMetrics.views, target: targets.views },
      ].map((ch) => {
        const percent = Math.min(100, Math.round((ch.current / ch.target) * 100));
        const level = percent >= 80 ? "Gold" : percent >= 50 ? "Silver" : "Bronze";
        return { ...ch, percent, level };
      });

      return { challenges, period: "7d", updated_at: new Date().toISOString() };
    });

    return c.json(data);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

async function fetchChallengeMetrics(pageId: string, token: string, since: string) {
  const result = { follows: 0, engagements: 0, views: 0 };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/insights?metric=page_daily_follows,page_post_engagements,page_video_views&period=day&since=${since}&access_token=${token}`);
    const data: any = await res.json();
    if (!data.error) {
      for (const m of (data.data || [])) {
        const total = (m.values || []).reduce((a: number, v: any) => a + (typeof v.value === "number" ? v.value : 0), 0);
        if (m.name === "page_daily_follows") result.follows = total;
        if (m.name === "page_post_engagements") result.engagements = total;
        if (m.name === "page_video_views") result.views = total;
      }
    }
  } catch {}
  return result;
}

// GET /api/challenges/:pageId/suggestions — tips per challenge
analytics.get("/challenges/:pageId/suggestions", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const pageId = c.req.param("pageId");
  const page = await c.env.DB.prepare(
    "SELECT page_id FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, pageId).first();
  if (!page) return c.json({ error: "Page not found" }, 404);

  // Get current challenge data to tailor suggestions
  const since = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const postCount = await c.env.DB.prepare("SELECT COUNT(*) as c FROM posts WHERE page_id=? AND created_at>=? AND status='posted'").bind(pageId, since).first<{c:number}>();
  const reelCount = await c.env.DB.prepare("SELECT COUNT(*) as c FROM posts WHERE page_id=? AND created_at>=? AND status='posted' AND post_type='reel'").bind(pageId, since).first<{c:number}>();

  const suggestions = [
    { id: "follows", tips: ["โพสช่วง 18:00-20:00 ดึง follower ใหม่ได้ดีสุด", "ใช้ hashtag trending ไทยเพิ่ม reach", "โพส Reel สั้น 15-30 วิ ดึง follower ใหม่ 3x"] },
    { id: "posts", tips: [`ต้องโพสอีก ${Math.max(0, 10 - (postCount?.c || 0))} อัน ถึง target`, "ใช้ปุ่ม 'ช่วยทำ' ให้ AI สร้างโพส + schedule อัตโนมัติ", "โพสวันละ 1-2 อัน ดีกว่ายิงรวดเดียว"] },
    { id: "reels", tips: [`ต้องสร้าง Reel อีก ${Math.max(0, 3 - (reelCount?.c || 0))} อัน`, "Reel 15-60 วิ ได้ algorithm boost 50%", "ถ่ายวิดีโอแนวตั้ง 9:16 ใส่ข้อความสั้นๆ"] },
    { id: "engagements", tips: ["โพสแบบถามคำถาม ได้ engagement 3x", "ตอบ comment ภายใน 1 ชม. เพิ่ม reach", "ใช้ Poll/Quiz ดึง interaction"] },
    { id: "views", tips: ["Reel สั้นได้ view สูงกว่า image 2-3x", "ใส่ hook 3 วินาทีแรกให้คนหยุดดู", "โพสช่วง 12:00 + 20:00 คนดูเยอะสุด"] },
  ];
  return c.json({ suggestions });
});

// POST /api/challenges/:pageId/boost — AI generate + schedule posts
analytics.post("/challenges/:pageId/boost", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const pageId = c.req.param("pageId");
  const { challenge_id, count } = await c.req.json() as { challenge_id: string; count?: number };

  if (!challenge_id || !["posts", "reels"].includes(challenge_id)) {
    return c.json({ error: "Boost ได้เฉพาะ posts หรือ reels" }, 400);
  }

  const page = await c.env.DB.prepare(
    "SELECT page_id, page_name FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, pageId).first<{ page_id: string; page_name: string }>();
  if (!page) return c.json({ error: "Page not found" }, 404);

  const numPosts = Math.min(count || 3, 5); // cap at 5

  // Generate posts via AI
  const aiSettings = await c.env.DB.prepare(
    "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
  ).bind(session.fb_id).first<{ provider: string; model: string; api_key: string; endpoint_url: string }>();
  const apiKey = aiSettings?.api_key || c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ error: "No AI API key — ตั้งค่าใน Settings > AI" }, 400);

  const prompt = `สร้าง ${numPosts} captions สำหรับ Facebook Page "${page.page_name}" ให้หลากหลาย สนุก มี engagement สูง
กฎ: ภาษาไทย, มีอีโมจิ, hashtag 3-5 อัน, แต่ละอันต่างหัวข้อกัน
ตอบเป็น JSON array: [{"text":"caption","hashtags":["#tag1"]}]
ตอบ JSON เท่านั้น`;

  try {
    let responseText = "";
    const model = aiSettings?.model || "claude-haiku-4-5-20251001";
    const endpoint = aiSettings?.endpoint_url || "https://api.anthropic.com/v1/messages";
    const provider = aiSettings?.provider || "anthropic";

    if (provider === "google") {
      const res = await fetch(`${endpoint}/${model}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
      const data: any = await res.json();
      responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (provider === "openai") {
      const res = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: "user", content: prompt }] }) });
      const data: any = await res.json();
      responseText = data.choices?.[0]?.message?.content || "";
    } else {
      const res = await fetch(endpoint, { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: "user", content: prompt }] }) });
      const data: any = await res.json();
      responseText = data.content?.[0]?.text || "";
    }

    // Parse AI response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return c.json({ error: "AI ไม่สามารถสร้างโพสได้ ลองใหม่อีกครั้ง" }, 500);
    const posts: { text: string; hashtags?: string[] }[] = JSON.parse(jsonMatch[0]);

    // Schedule posts with 2-hour intervals starting from next hour
    const scheduled: { message: string; scheduled_at: string }[] = [];
    const startTime = new Date();
    startTime.setMinutes(0, 0, 0);
    startTime.setHours(startTime.getHours() + 1);

    for (let i = 0; i < Math.min(posts.length, numPosts); i++) {
      const p = posts[i];
      const message = p.text + (p.hashtags?.length ? "\n\n" + p.hashtags.join(" ") : "");
      const schedAt = new Date(startTime.getTime() + i * 2 * 3600000).toISOString();

      await c.env.DB.prepare(
        "INSERT INTO scheduled_posts (user_fb_id, page_id, message, scheduled_at) VALUES (?, ?, ?, ?)"
      ).bind(session.fb_id, pageId, message, schedAt).run();

      scheduled.push({ message: message.slice(0, 80) + "...", scheduled_at: schedAt });
    }

    // Clear challenges cache
    await c.env.KV.delete(`challenges:${pageId}:v1`);

    return c.json({ ok: true, generated: scheduled.length, scheduled, note: "โพสจะเผยแพร่อัตโนมัติตามเวลาที่ตั้งไว้ (ทุก 2 ชม.)" });
  } catch (e: any) {
    return c.json({ error: "AI error: " + e.message }, 500);
  }
});

export default analytics;
