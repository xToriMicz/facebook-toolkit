import { Hono } from "hono";
import type { Env } from "../helpers";
import { getSessionFromReq } from "../helpers";

const notifications = new Hono<{ Bindings: Env }>();

// GET /api/notifications — recent activity + unread count
notifications.get("/notifications", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const limit = Math.min(30, +(c.req.query("limit") || "20"));

  const { results } = await c.env.DB.prepare(
    "SELECT id, action, detail, post_id, created_at, read_at FROM activity_logs WHERE user_fb_id = ? ORDER BY created_at DESC LIMIT ?"
  ).bind(session.fb_id, limit).all();

  const unreadCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM activity_logs WHERE user_fb_id = ? AND read_at IS NULL"
  ).bind(session.fb_id).first<{ count: number }>();

  return c.json({
    notifications: results,
    unread: unreadCount?.count || 0,
  });
});

// POST /api/notifications/read — mark all as read
notifications.post("/notifications/read", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  await c.env.DB.prepare(
    "UPDATE activity_logs SET read_at = ? WHERE user_fb_id = ? AND read_at IS NULL"
  ).bind(new Date().toISOString(), session.fb_id).run();

  return c.json({ ok: true });
});

export default notifications;
