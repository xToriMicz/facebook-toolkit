import { Hono } from "hono";
import { Env, getSessionFromReq } from "../helpers";

const promptLogs = new Hono<{ Bindings: Env }>();

// POST /api/prompt-logs — save a prompt log
promptLogs.post("/prompt-logs", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { type, prompt, result, model, tone, aspect_ratio, overlay_text, image_url } = await c.req.json() as any;
  if (!type || !prompt) return c.json({ error: "type and prompt required" }, 400);

  await c.env.DB.prepare(
    "INSERT INTO prompt_logs (user_fb_id, type, prompt, result, model, tone, aspect_ratio, overlay_text, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(session.fb_id, type, prompt.slice(0, 5000), (result || "").slice(0, 5000), model || null, tone || null, aspect_ratio || null, overlay_text || null, image_url || null).run();

  return c.json({ ok: true });
});

// GET /api/prompt-logs — get recent logs
promptLogs.get("/prompt-logs", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const limit = Math.min(50, +(c.req.query("limit") || "20"));
  const type = c.req.query("type"); // 'text', 'image', or all

  let query = "SELECT * FROM prompt_logs WHERE user_fb_id = ?";
  const params: any[] = [session.fb_id];
  if (type) { query += " AND type = ?"; params.push(type); }
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ logs: results, total: results.length });
});

export default promptLogs;
