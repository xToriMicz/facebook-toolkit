import { Hono } from "hono";
import { Env, getSessionFromReq } from "../helpers";

const analytics = new Hono<{ Bindings: Env }>();

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
    const metrics = "page_impressions,page_engaged_users,page_post_engagements,page_fan_adds";
    const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/insights?metric=${metrics}&period=day&access_token=${page.page_token}`);
    const data = await res.json() as any;
    if (data.error) return c.json({ error: data.error.message }, 400);
    return c.json({ ok: true, insights: data.data || [] });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// GET /api/activity
analytics.get("/activity", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM activity_logs WHERE user_fb_id = ? ORDER BY created_at DESC LIMIT 20"
  ).bind(session.fb_id).all();
  return c.json({ activities: results, total: results.length });
});

// GET /api/analytics/performance
analytics.get("/analytics/performance", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { results: topPosts } = await c.env.DB.prepare(
    "SELECT *, (COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as engagement FROM posts WHERE status = 'posted' ORDER BY engagement DESC LIMIT 10"
  ).all();
  const { results: worstPosts } = await c.env.DB.prepare(
    "SELECT *, (COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as engagement FROM posts WHERE status = 'posted' ORDER BY engagement ASC LIMIT 5"
  ).all();
  const avg = await c.env.DB.prepare(
    "SELECT AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as total_posts, SUM(COALESCE(likes,0)) as total_likes, SUM(COALESCE(comments,0)) as total_comments, SUM(COALESCE(shares,0)) as total_shares FROM posts WHERE status = 'posted'"
  ).first<any>();
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
      const res = await fetch(`https://graph.facebook.com/v25.0/${post.fb_post_id}?fields=likes.summary(true),comments.summary(true),shares&access_token=${page.page_token}`);
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

export default analytics;
