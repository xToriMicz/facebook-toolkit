/**
 * Observable Logs API
 * ดู event_logs ย้อนหลัง — cron, API calls, duplicates, errors
 */
import { Hono } from "hono";
import { getSession } from "../auth";
import { Env } from "../helpers";

const logs = new Hono<{ Bindings: Env }>();

// GET /api/logs — query event_logs
logs.get("/logs", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const limit = Math.min(100, +(c.req.query("limit") || "50"));
  const eventType = c.req.query("type");
  const source = c.req.query("source");
  const pageId = c.req.query("page_id");
  const from = c.req.query("from");
  const to = c.req.query("to");

  let q = "SELECT * FROM event_logs WHERE 1=1";
  const params: any[] = [];

  if (eventType) { q += " AND event_type = ?"; params.push(eventType); }
  if (source) { q += " AND source = ?"; params.push(source); }
  if (pageId) { q += " AND page_id = ?"; params.push(pageId); }
  if (from) { q += " AND created_at >= ?"; params.push(from); }
  if (to) { q += " AND created_at <= ?"; params.push(to); }

  q += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const { results } = await c.env.DB.prepare(q).bind(...params).all();
  return c.json({ logs: results, total: results.length });
});

// GET /api/logs/trace/:traceId — ทุก event ของ trace
logs.get("/logs/trace/:traceId", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const traceId = c.req.param("traceId");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM event_logs WHERE trace_id = ? ORDER BY created_at ASC"
  ).bind(traceId).all();

  return c.json({ trace_id: traceId, events: results, total: results.length });
});

// GET /api/logs/anomalies — duplicates + errors ล่าสุด
logs.get("/logs/anomalies", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const limit = Math.min(50, +(c.req.query("limit") || "20"));
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM event_logs WHERE event_type IN ('duplicate_detected', 'error') ORDER BY created_at DESC LIMIT ?"
  ).bind(limit).all();

  return c.json({ anomalies: results, total: results.length });
});

export default logs;
