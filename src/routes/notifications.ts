import { Hono } from "hono";
import type { Env } from "../helpers";
import { getSessionFromReq } from "../helpers";

const notifications = new Hono<{ Bindings: Env }>();

// GET /api/notifications — from notifications table + unread count
notifications.get("/notifications", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const limit = Math.min(50, +(c.req.query("limit") || "20"));
  const priority = c.req.query("priority"); // urgent, important, normal

  let query = "SELECT * FROM notifications WHERE user_fb_id = ?";
  const binds: any[] = [session.fb_id];

  if (priority) {
    query += " AND priority = ?";
    binds.push(priority);
  }

  query += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, created_at DESC LIMIT ?";
  binds.push(limit);

  const stmt = c.env.DB.prepare(query);
  const { results } = await stmt.bind(...binds).all();

  const unreadCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM notifications WHERE user_fb_id = ? AND read_at IS NULL"
  ).bind(session.fb_id).first<{ count: number }>();

  const urgentCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM notifications WHERE user_fb_id = ? AND read_at IS NULL AND priority = 'urgent'"
  ).bind(session.fb_id).first<{ count: number }>();

  return c.json({
    notifications: results,
    unread: unreadCount?.count || 0,
    urgent: urgentCount?.count || 0,
  });
});

// POST /api/notifications/read — mark all as read
notifications.post("/notifications/read", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = ? WHERE user_fb_id = ? AND read_at IS NULL"
  ).bind(new Date().toISOString(), session.fb_id).run();

  return c.json({ ok: true });
});

// POST /api/notifications/:id/read — mark single as read
notifications.post("/notifications/:id/read", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const id = c.req.param("id");
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = ? WHERE id = ? AND user_fb_id = ?"
  ).bind(new Date().toISOString(), id, session.fb_id).run();

  return c.json({ ok: true });
});

// GET /api/notifications/prefs — get notification preferences
notifications.get("/notifications/prefs", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const prefs = await c.env.DB.prepare(
    "SELECT * FROM notification_prefs WHERE user_fb_id = ?"
  ).bind(session.fb_id).first();

  return c.json({ prefs: prefs || { auto_reply: 1, outbound: 1, post_ok: 1, post_fail: 1, scheduled: 1, comment_new: 1, error: 1 } });
});

// POST /api/notifications/prefs — update preferences
notifications.post("/notifications/prefs", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const body = await c.req.json() as Record<string, any>;
  const fields = ["auto_reply", "outbound", "post_ok", "post_fail", "scheduled", "comment_new", "error"];
  const updates: string[] = [];
  const values: any[] = [];

  for (const f of fields) {
    if (body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(body[f] ? 1 : 0);
    }
  }

  if (!updates.length) return c.json({ ok: true });

  await c.env.DB.prepare(
    `INSERT INTO notification_prefs (user_fb_id, ${fields.join(", ")}) VALUES (?, ${fields.map(() => "1").join(", ")}) ON CONFLICT(user_fb_id) DO UPDATE SET ${updates.join(", ")}`
  ).bind(session.fb_id, ...values).run();

  return c.json({ ok: true });
});

// Helper: create notification + activity log (exported for use in other routes)
// Single function writes to both tables — Noti for alerts, Activity Log for audit trail
export async function createNotification(
  db: any,
  userFbId: string,
  opts: { page_id?: string; type: string; priority?: string; title: string; detail?: string; link?: string; source_id?: string }
) {
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO notifications (user_fb_id, page_id, type, priority, title, detail, link, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    userFbId,
    opts.page_id || null,
    opts.type,
    opts.priority || "normal",
    opts.title,
    opts.detail || null,
    opts.link || null,
    opts.source_id || null,
  ).run();
  await db.prepare(
    "INSERT INTO activity_logs (user_fb_id, action, detail, post_id, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(
    userFbId,
    opts.type,
    (opts.title + (opts.detail ? ": " + opts.detail : "")).slice(0, 300),
    opts.source_id || null,
    now,
  ).run();
}

export default notifications;
