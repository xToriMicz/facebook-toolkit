import { Hono } from "hono";
import { Env, getSessionFromReq } from "../helpers";

const drafts = new Hono<{ Bindings: Env }>();

drafts.post("/drafts", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { message, image_url, page_id } = await c.req.json();
  if (!message) return c.json({ error: "message required" }, 400);
  const { meta } = await c.env.DB.prepare(
    "INSERT INTO drafts (user_fb_id, page_id, message, image_url) VALUES (?, ?, ?, ?)"
  ).bind(session.fb_id, page_id || null, message, image_url || null).run();
  return c.json({ ok: true, id: meta.last_row_id }, 201);
});

drafts.get("/drafts", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM drafts WHERE user_fb_id = ? ORDER BY updated_at DESC"
  ).bind(session.fb_id).all();
  return c.json({ drafts: results, total: results.length });
});

drafts.put("/drafts/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  const { message, image_url, page_id } = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE drafts SET message = ?, image_url = ?, page_id = ?, updated_at = datetime('now') WHERE id = ? AND user_fb_id = ?"
  ).bind(message, image_url || null, page_id || null, id, session.fb_id).run();
  return c.json({ ok: true });
});

drafts.delete("/drafts/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM drafts WHERE id = ? AND user_fb_id = ?").bind(id, session.fb_id).run();
  return c.json({ ok: true });
});

drafts.post("/drafts/:id/publish", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  const draft = await c.env.DB.prepare(
    "SELECT * FROM drafts WHERE id = ? AND user_fb_id = ?"
  ).bind(id, session.fb_id).first<any>();
  if (!draft) return c.json({ error: "Draft not found" }, 404);

  const pageId = draft.page_id || await c.env.KV.get("fb_page_id");
  if (!pageId) return c.json({ error: "No page selected" }, 400);
  const page = await c.env.DB.prepare(
    "SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, pageId).first<{ page_token: string }>();
  if (!page?.page_token) return c.json({ error: "Page token missing" }, 400);

  const endpoint = draft.image_url ? `${pageId}/photos` : `${pageId}/feed`;
  const body: any = { access_token: page.page_token };
  if (draft.image_url) { body.url = draft.image_url; body.message = draft.message; }
  else { body.message = draft.message; }

  const res = await fetch(`https://graph.facebook.com/v25.0/${endpoint}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result: any = await res.json();
  if (result.error) return c.json({ error: result.error.message }, 400);

  await c.env.DB.prepare("DELETE FROM drafts WHERE id = ?").bind(id).run();
  await c.env.DB.prepare(
    "INSERT INTO posts (message, image_url, fb_post_id, status, created_at) VALUES (?, ?, ?, 'posted', ?)"
  ).bind(draft.message, draft.image_url, result.id || result.post_id, new Date().toISOString()).run();

  return c.json({ ok: true, result });
});

export default drafts;
