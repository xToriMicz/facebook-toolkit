import { Hono } from "hono";
import { Env, getSessionFromReq, kvCache, getUserPageId, getUserPageToken, getDecryptedPageToken } from "../helpers";

const analytics = new Hono<{ Bindings: Env }>();

// GET /api/pages — list user's pages (no token exposed)
analytics.get("/pages", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { results } = await c.env.DB.prepare(
    "SELECT page_id, page_name, category, picture_url FROM user_pages WHERE user_fb_id = ?"
  ).bind(session.fb_id).all();
  const selectedPageId = await getUserPageId(c.env.KV, session.fb_id);
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
  const encKey = c.env.TOKEN_ENCRYPTION_KEY || c.env.FB_APP_SECRET;
  const pageToken = await getDecryptedPageToken(c.env.DB, session.fb_id, pageId, encKey);
  if (!pageToken) return c.json({ error: "Page not found" }, 404);
  try {
    const metrics = "page_views_total,page_post_engagements,page_actions_post_reactions_total,page_daily_follows";
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/insights?metric=${metrics}&period=day&access_token=${pageToken}`);
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
    const pageId = c.req.query("page_id");
    const limit = Math.min(100, +(c.req.query("limit") || "50"));

    let query = "SELECT * FROM activity_logs WHERE user_fb_id = ?";
    const params: (string | number)[] = [session.fb_id];

    if (pageId) { query += " AND page_id = ?"; params.push(pageId); }
    if (search) { query += " AND (action LIKE ? OR details LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
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
  const pageId = c.req.query("page_id");

  const [postsToday, aiToday, scheduledToday, draftsToday] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM posts WHERE created_at >= ? AND (user_fb_id = ? OR user_fb_id IS NULL)" + (pageId ? " AND page_id = ?" : "")).bind(...[today, session.fb_id, ...(pageId ? [pageId] : [])]).first<{count:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM activity_logs WHERE action LIKE '%ai%' AND created_at >= ? AND user_fb_id = ?" + (pageId ? " AND page_id = ?" : "")).bind(...[today, session.fb_id, ...(pageId ? [pageId] : [])]).first<{count:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM scheduled_posts WHERE status = 'pending' AND user_fb_id = ?" + (pageId ? " AND page_id = ?" : "")).bind(...[session.fb_id, ...(pageId ? [pageId] : [])]).first<{count:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM drafts WHERE user_fb_id = ?" + (pageId ? " AND page_id = ?" : "")).bind(...[session.fb_id, ...(pageId ? [pageId] : [])]).first<{count:number}>(),
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
  const pageId = c.req.query("page_id");
  const since = new Date(Date.now() - days * 86400000).toISOString();

  let q = "SELECT date(created_at) as day, action, COUNT(*) as count FROM activity_logs WHERE user_fb_id = ? AND created_at >= ?";
  const binds: any[] = [session.fb_id, since];
  if (pageId) { q += " AND page_id = ?"; binds.push(pageId); }
  q += " GROUP BY day, action ORDER BY day DESC";

  const { results } = await c.env.DB.prepare(q).bind(...binds).all();

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
  const pageId = c.req.query("page_id");
  const where = "status = 'posted' AND (user_fb_id = ? OR user_fb_id IS NULL)" + (pageId ? " AND page_id = ?" : "");
  const binds = pageId ? [session.fb_id, pageId] : [session.fb_id];
  const { results: topPosts } = await c.env.DB.prepare(
    "SELECT *, (COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as engagement FROM posts WHERE " + where + " ORDER BY engagement DESC LIMIT 10"
  ).bind(...binds).all();
  const { results: worstPosts } = await c.env.DB.prepare(
    "SELECT *, (COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as engagement FROM posts WHERE " + where + " ORDER BY engagement ASC LIMIT 5"
  ).bind(...binds).all();
  const avg = await c.env.DB.prepare(
    "SELECT AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as total_posts, SUM(COALESCE(likes,0)) as total_likes, SUM(COALESCE(comments,0)) as total_comments, SUM(COALESCE(shares,0)) as total_shares FROM posts WHERE " + where
  ).bind(...binds).first<any>();
  return c.json({ top: topPosts, worst: worstPosts, summary: avg });
});

// GET /api/analytics/best-time
analytics.get("/analytics/best-time", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const pageId = c.req.query("page_id");
  const where = "status = 'posted' AND (user_fb_id = ? OR user_fb_id IS NULL)" + (pageId ? " AND page_id = ?" : "");
  const binds = pageId ? [session.fb_id, pageId] : [session.fb_id];
  const { results: byHour } = await c.env.DB.prepare(
    "SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as post_count FROM posts WHERE " + where + " GROUP BY hour ORDER BY avg_engagement DESC"
  ).bind(...binds).all();
  const { results: byDay } = await c.env.DB.prepare(
    "SELECT CAST(strftime('%w', created_at) AS INTEGER) as day, AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as post_count FROM posts WHERE " + where + " GROUP BY day ORDER BY avg_engagement DESC"
  ).bind(...binds).all();
  const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const bestHours = (byHour as any[]).slice(0, 3).map((h: any) => h.hour);
  const bestDays = (byDay as any[]).slice(0, 3).map((d: any) => dayNames[d.day]);
  const { results: heatmap } = await c.env.DB.prepare(
    "SELECT CAST(strftime('%w', created_at) AS INTEGER) as day, CAST(strftime('%H', created_at) AS INTEGER) as hour, AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as count FROM posts WHERE " + where + " GROUP BY day, hour"
  ).bind(...binds).all();
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
  const targetPageId = await getUserPageId(c.env.KV, session.fb_id);
  if (!targetPageId) return c.json({ error: "No page" }, 400);
  const encKey = c.env.TOKEN_ENCRYPTION_KEY || c.env.FB_APP_SECRET;
  const pageToken = await getDecryptedPageToken(c.env.DB, session.fb_id, targetPageId, encKey);
  if (!pageToken) return c.json({ error: "No token" }, 400);
  const { results: posts } = await c.env.DB.prepare(
    "SELECT id, fb_post_id FROM posts WHERE fb_post_id IS NOT NULL AND status = 'posted' AND (user_fb_id = ? OR user_fb_id IS NULL) ORDER BY created_at DESC LIMIT 20"
  ).bind(session.fb_id).all();
  let updated = 0;
  for (const post of posts as any[]) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${post.fb_post_id}?fields=likes.summary(true),comments.summary(true),shares&access_token=${pageToken}`);
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
  const encKey = c.env.TOKEN_ENCRYPTION_KEY || c.env.FB_APP_SECRET;
  const pageToken = await getDecryptedPageToken(c.env.DB, session.fb_id, page_id, encKey);
  if (!pageToken) return c.json({ error: "Page not found" }, 404);

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${page_id}/posts?fields=id,message,created_time,likes.summary(true),comments.summary(true),shares&limit=50&access_token=${pageToken}`);
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

  const encKey = c.env.TOKEN_ENCRYPTION_KEY || c.env.FB_APP_SECRET;
  const pageToken = await getDecryptedPageToken(c.env.DB, session.fb_id, pageId, encKey);
  if (!pageToken) return c.json({ error: "Page not found" }, 404);

  try {
    const data = await kvCache(c.env.KV, `insights:${session.fb_id}:${pageId}:v3`, 180, async () => {
      const [insights, performance, bestTime, stats] = await Promise.all([
        fetchInsights(pageId, pageToken),
        fetchPerformance(c.env.DB, pageId, session.fb_id),
        fetchBestTime(c.env.DB, pageId, session.fb_id),
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

async function fetchPerformance(db: D1Database, pageId: string, fbId?: string) {
  const userFilter = fbId ? " AND (user_fb_id = ? OR user_fb_id IS NULL)" : "";
  const params1 = fbId ? [pageId, fbId] : [pageId];
  const params2 = fbId ? [pageId, fbId] : [pageId];
  const [top, avg] = await Promise.all([
    db.prepare(`SELECT id, message, fb_post_id, page_id, (COALESCE(likes,0)+COALESCE(comments,0)+COALESCE(shares,0)) as eng, likes, comments, shares, created_at FROM posts WHERE status='posted' AND page_id=?${userFilter} ORDER BY eng DESC LIMIT 5`).bind(...params1).all(),
    db.prepare(`SELECT AVG(COALESCE(likes,0)+COALESCE(comments,0)+COALESCE(shares,0)) as avg_eng, COUNT(*) as total, SUM(COALESCE(likes,0)) as likes, SUM(COALESCE(comments,0)) as comments, SUM(COALESCE(shares,0)) as shares FROM posts WHERE status='posted' AND page_id=?${userFilter}`).bind(...params2).first<any>(),
  ]);
  return { top: top.results, avg_eng: avg?.avg_eng || 0, total: avg?.total || 0, likes: avg?.likes || 0, comments: avg?.comments || 0, shares: avg?.shares || 0 };
}

async function fetchBestTime(db: D1Database, pageId: string, fbId?: string) {
  const userFilter = fbId ? " AND (user_fb_id = ? OR user_fb_id IS NULL)" : "";
  const params = fbId ? [pageId, fbId] : [pageId];
  const { results } = await db.prepare(
    `SELECT CAST(strftime('%w',created_at) AS INTEGER) as d, CAST(strftime('%H',created_at) AS INTEGER) as h, AVG(COALESCE(likes,0)+COALESCE(comments,0)+COALESCE(shares,0)) as eng, COUNT(*) as n FROM posts WHERE status='posted' AND page_id=?${userFilter} GROUP BY d,h`
  ).bind(...params).all();
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

  const encKey = c.env.TOKEN_ENCRYPTION_KEY || c.env.FB_APP_SECRET;
  const challengeToken = await getDecryptedPageToken(c.env.DB, session.fb_id, pageId, encKey);
  if (!challengeToken) return c.json({ error: "Page not found" }, 404);

  try {
    const data = await kvCache(c.env.KV, `challenges:${session.fb_id}:${pageId}:v2`, 600, async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

      const [fbMetrics, postCount, reelCount, recentPosts, recentReels] = await Promise.all([
        fetchChallengeMetrics(pageId, challengeToken, since),
        c.env.DB.prepare("SELECT COUNT(*) as c FROM posts WHERE page_id = ? AND created_at >= ? AND status = 'posted'").bind(pageId, since).first<{ c: number }>(),
        c.env.DB.prepare("SELECT COUNT(*) as c FROM posts WHERE page_id = ? AND created_at >= ? AND status = 'posted' AND post_type = 'reel'").bind(pageId, since).first<{ c: number }>(),
        c.env.DB.prepare("SELECT message, created_at FROM posts WHERE page_id = ? AND created_at >= ? AND status = 'posted' ORDER BY created_at DESC LIMIT 10").bind(pageId, since).all(),
        c.env.DB.prepare("SELECT message, created_at FROM posts WHERE page_id = ? AND created_at >= ? AND status = 'posted' AND post_type = 'reel' ORDER BY created_at DESC LIMIT 5").bind(pageId, since).all(),
      ]);

      const targets = { follows: 100, posts: 10, reels: 3, engagements: 500, views: 1000 };

      const postsList = (recentPosts.results || []).map((p: any) => ({ message: (p.message || "").slice(0, 60), created_at: p.created_at }));
      const reelsList = (recentReels.results || []).map((p: any) => ({ message: (p.message || "").slice(0, 60), created_at: p.created_at }));

      const challenges = [
        { id: "follows", name: "ผู้ติดตามใหม่", icon: "👥", current: fbMetrics.follows, target: targets.follows, details: `7 วันที่ผ่านมาได้ผู้ติดตามใหม่ ${fbMetrics.follows} คน` },
        { id: "posts", name: "สร้างโพสต์", icon: "📝", current: postCount?.c || 0, target: targets.posts, details: postsList },
        { id: "reels", name: "สร้าง Reels", icon: "🎬", current: reelCount?.c || 0, target: targets.reels, details: reelsList.length ? reelsList : "ยังไม่มี Reel ในสัปดาห์นี้" },
        { id: "engagements", name: "ได้โต้ตอบ", icon: "❤️", current: fbMetrics.engagements, target: targets.engagements, details: `รวม ${fbMetrics.engagements} interactions (likes, comments, shares)` },
        { id: "views", name: "เพิ่มยอดดู", icon: "👁️", current: fbMetrics.views, target: targets.views, details: `ยอดดูวิดีโอรวม ${fbMetrics.views} ครั้ง` },
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

// Default prompt templates
const DEFAULT_TEMPLATES = [
  { id: "cinematic", name: "SnapMingle Cinematic Poster", desc: "สไตล์หนัง cinematic มืดเข้ม ดราม่า", prompt: "Cinematic movie poster style, dramatic lighting, dark moody atmosphere, film grain, {keyword}, professional photography, 4K" },
  { id: "morning", name: "สวัสดีตอนเช้า", desc: "รูปสวัสดีตอนเช้า สดใส อบอุ่น", prompt: "Good morning greeting card, warm golden sunrise, flowers, coffee cup, {keyword}, soft warm lighting, Thai style" },
  { id: "quote", name: "Quote Card", desc: "การ์ดคำคม พื้นหลังสวย", prompt: "Inspirational quote card, beautiful gradient background, elegant typography space, {keyword}, minimalist modern design" },
  { id: "product", name: "โชว์สินค้า", desc: "รูปสินค้า พื้นหลังสะอาด", prompt: "Product showcase, clean white background, studio lighting, professional product photography, {keyword}, e-commerce style" },
  { id: "food", name: "อาหาร/คาเฟ่", desc: "รูปอาหาร น่ากิน สไตล์คาเฟ่", prompt: "Delicious food photography, cafe aesthetic, warm lighting, overhead shot, {keyword}, Instagram style, appetizing" },
  { id: "nature", name: "ธรรมชาติ", desc: "วิวธรรมชาติ สวย สงบ", prompt: "Beautiful nature landscape, serene peaceful atmosphere, {keyword}, golden hour lighting, wide angle" },
];

// GET /api/ai-image/templates — list available prompt templates (public)
analytics.get("/ai-image/templates", async (c) => {
  // Public endpoint — no auth required (static data, no user info)
  const custom = await c.env.KV.get("ai_image_templates");
  const customTemplates = custom ? JSON.parse(custom) : [];
  return c.json({ templates: [...DEFAULT_TEMPLATES, ...customTemplates] });
});

// POST /api/ai-image — generate image or prompt from template
analytics.post("/ai-image", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { prompt, template_id, keyword } = await c.req.json() as {
    prompt?: string; template_id?: string; keyword?: string;
  };

  let finalPrompt = "";

  if (template_id) {
    const custom = await c.env.KV.get("ai_image_templates");
    const all = [...DEFAULT_TEMPLATES, ...(custom ? JSON.parse(custom) : [])];
    // Match by id or partial name
    const tpl = all.find((t: any) => t.id === template_id || t.name.includes(template_id));
    if (!tpl) return c.json({ error: "Template not found", available: all.map((t: any) => t.id) }, 404);
    finalPrompt = tpl.prompt.replace(/\{keyword\}/g, keyword || "");
  } else if (prompt) {
    if (prompt.length > 2000) return c.json({ error: "prompt too long (max 2000)" }, 400);
    finalPrompt = prompt;
  } else {
    return c.json({ error: "prompt or template_id required" }, 400);
  }

  // Gemini Nano Banana Pro — generate image via Gemini API
  const geminiKey = await c.env.KV.get("gemini_api_key");
  const result: any = { ok: true, prompt: finalPrompt, provider: "gemini" };

  if (geminiKey) {
    try {
      const gemRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate an image: ${finalPrompt}` }] }],
          generationConfig: { responseModalities: ["TEXT"] },
        }),
      });
      const gemData: any = await gemRes.json();
      if (gemData.error) {
        result.note = "Gemini error: " + gemData.error.message;
      } else {
        result.gemini_response = gemData.candidates?.[0]?.content?.parts?.[0]?.text || null;
        result.note = "Prompt สร้างแล้ว — copy ไปใช้ใน Nano Banana Pro app";
      }
    } catch (e: any) {
      result.note = "Gemini error: " + e.message;
    }
  } else {
    result.note = "กรุณากรอก Gemini API key ใน Settings ก่อน";
  }

  return c.json(result);
});

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

// POST /api/challenges/:pageId/boost — AI generate mixed posts + schedule
analytics.post("/challenges/:pageId/boost", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const pageId = c.req.param("pageId");
  const { challenge_id, count, types } = await c.req.json() as { challenge_id: string; count?: number; types?: string[] };

  if (!challenge_id || !["posts", "reels"].includes(challenge_id)) {
    return c.json({ error: "Boost ได้เฉพาะ posts หรือ reels" }, 400);
  }

  const page = await c.env.DB.prepare(
    "SELECT page_id, page_name FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, pageId).first<{ page_id: string; page_name: string }>();
  if (!page) return c.json({ error: "Page not found" }, 404);

  const numPosts = Math.min(count || 3, 5);
  const postTypes = types?.length ? types : ["text", "photo", "question"];

  const aiSettings = await c.env.DB.prepare(
    "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
  ).bind(session.fb_id).first<{ provider: string; model: string; api_key: string; endpoint_url: string }>();
  const apiKey = aiSettings?.api_key || c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ error: "No AI API key — ตั้งค่าใน Settings > AI" }, 400);

  const typeInstructions = postTypes.map((t, i) => {
    if (t === "photo") return `โพส ${i + 1}: caption สำหรับโพสรูป + ใส่ "image_query" เป็นคำค้น Unsplash ภาษาอังกฤษ 2-3 คำ`;
    if (t === "link") return `โพส ${i + 1}: caption แนะนำสินค้า + ใส่ "link_type":"shopee" เพื่อแนบ link สินค้า`;
    if (t === "question") return `โพส ${i + 1}: โพสแบบถามคำถาม/poll ดึง engagement ใส่ "type":"question"`;
    return `โพส ${i + 1}: caption ข้อความทั่วไป`;
  }).join("\n");

  const prompt = `สร้าง ${numPosts} โพสสำหรับ Facebook Page "${page.page_name}":
${typeInstructions}
กฎ: ภาษาไทย, มีอีโมจิ, hashtag 3-5 อัน, หลากหลายหัวข้อ
ตอบ JSON array: [{"text":"caption","hashtags":["#tag1"],"type":"text|photo|question|link","image_query":"sunset nature"}]
ตอบ JSON เท่านั้น`;

  try {
    const responseText = await callAI(aiSettings, apiKey, prompt);
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return c.json({ error: "AI ไม่สามารถสร้างโพสได้ ลองใหม่อีกครั้ง" }, 500);
    const posts: { text: string; hashtags?: string[]; type?: string; image_query?: string; link_type?: string }[] = JSON.parse(jsonMatch[0]);

    const scheduled: { message: string; image_url?: string; scheduled_at: string; type: string }[] = [];
    const startTime = new Date();
    startTime.setMinutes(0, 0, 0);
    startTime.setHours(startTime.getHours() + 1);

    for (let i = 0; i < Math.min(posts.length, numPosts); i++) {
      const p = posts[i];
      const message = p.text + (p.hashtags?.length ? "\n\n" + p.hashtags.join(" ") : "");
      const schedAt = new Date(startTime.getTime() + i * 2 * 3600000).toISOString();
      let imageUrl: string | null = null;

      // Fetch Unsplash image for photo type
      if (p.type === "photo" && p.image_query) {
        imageUrl = await fetchUnsplashImage(p.image_query);
      }

      await c.env.DB.prepare(
        "INSERT INTO scheduled_posts (user_fb_id, page_id, message, image_url, scheduled_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(session.fb_id, pageId, message, imageUrl, schedAt).run();

      scheduled.push({ message: message.slice(0, 80) + "...", image_url: imageUrl || undefined, scheduled_at: schedAt, type: p.type || "text" });
    }

    await c.env.KV.delete(`challenges:${pageId}:v2`);
    return c.json({ ok: true, generated: scheduled.length, scheduled, note: "โพสจะเผยแพร่อัตโนมัติตามเวลาที่ตั้งไว้ (ทุก 2 ชม.)" });
  } catch (e: any) {
    return c.json({ error: "AI error: " + e.message }, 500);
  }
});

async function callAI(settings: any, apiKey: string, prompt: string): Promise<string> {
  const provider = settings?.provider || "anthropic";
  const model = settings?.model || "claude-haiku-4-5-20251001";
  const endpoint = settings?.endpoint_url || "https://api.anthropic.com/v1/messages";
  if (provider === "google") {
    const res = await fetch(`${endpoint}/${model}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    const data: any = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } else if (provider === "openai") {
    const res = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: "user", content: prompt }] }) });
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }
  const res = await fetch(endpoint, { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: "user", content: prompt }] }) });
  const data: any = await res.json();
  return data.content?.[0]?.text || "";
}

async function fetchUnsplashImage(query: string): Promise<string | null> {
  // Pollinations.ai — free AI image generation, URL-based
  // FB will fetch the image from this URL when posting
  const prompt = encodeURIComponent(query + ", social media post, vibrant, high quality");
  return `https://image.pollinations.ai/prompt/${prompt}?width=1200&height=630&nologo=true`;
}

// GET /api/ai-image/snapmingle — fetch SnapMingle prompts, cached 24h (public)
analytics.get("/ai-image/snapmingle", async (c) => {
  // Public endpoint — prompt gallery is not user-specific
  const page = +(c.req.query("page") || "1");
  const perPage = 10;

  try {
    const cacheKey = `snapmingle:prompts:p${page}`;
    const data = await kvCache(c.env.KV, cacheKey, 86400, async () => {
      const start = (page - 1) * perPage + 1;
      const ids = Array.from({ length: perPage }, (_, i) => start + i).filter(i => i <= 140);
      const prompts: { id: string; title: string; prompt: string }[] = [];

      const results = await Promise.all(ids.map(async (id) => {
        const padded = String(id).padStart(3, "0");
        try {
          const res = await fetch(`https://snapmingle.online/ai-prompt-gallery/Prompt-${padded}`, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; FBToolkit/1.0)" },
          });
          if (!res.ok) return null;
          const html = await res.text();
          const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
          const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) || html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
          const title = titleMatch?.[1]?.replace(/ - SnapMingle.*$/, "").trim() || `Prompt ${padded}`;
          const prompt = descMatch?.[1]?.trim() || "";
          if (prompt) return { id: `Prompt-${padded}`, title, prompt };
        } catch {}
        return null;
      }));

      results.forEach(r => { if (r) prompts.push(r); });
      return { prompts, page, total: 140, pages: Math.ceil(140 / perPage) };
    });

    return c.json(data);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default analytics;
