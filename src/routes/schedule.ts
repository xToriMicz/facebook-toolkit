import { Hono } from "hono";
import { Env, getSessionFromReq, getUserPageId, decryptToken } from "../helpers";

const schedule = new Hono<{ Bindings: Env }>();

// POST /api/schedule + /api/post/schedule
schedule.post("/schedule", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { page_id, message, image_url, scheduled_at } = await c.req.json();
  if (!message || !scheduled_at) return c.json({ error: "message and scheduled_at required" }, 400);

  const targetPageId = page_id || await getUserPageId(c.env.KV, session.fb_id);
  if (!targetPageId) return c.json({ error: "No page selected" }, 400);

  const page = await c.env.DB.prepare(
    "SELECT page_id FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, targetPageId).first();
  if (!page) return c.json({ error: "Page not found for this user" }, 400);

  const { meta } = await c.env.DB.prepare(
    "INSERT INTO scheduled_posts (user_fb_id, page_id, message, image_url, scheduled_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(session.fb_id, targetPageId, message, image_url || null, scheduled_at).run();

  return c.json({ ok: true, id: meta.last_row_id }, 201);
});

// POST /api/schedule/bulk
schedule.post("/schedule/bulk", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { posts, page_id } = await c.req.json();
  if (!Array.isArray(posts) || posts.length === 0) return c.json({ error: "posts array required" }, 400);
  if (posts.length > 20) return c.json({ error: "Maximum 20 posts per bulk schedule" }, 400);

  const targetPageId = page_id || await getUserPageId(c.env.KV, session.fb_id);
  if (!targetPageId) return c.json({ error: "No page selected" }, 400);

  const page = await c.env.DB.prepare(
    "SELECT page_id FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, targetPageId).first();
  if (!page) return c.json({ error: "Page not found for this user" }, 400);

  const results: { id: number | null; message: string; scheduled_at: string }[] = [];
  for (const post of posts) {
    if (!post.message || !post.scheduled_at) continue;
    const { meta } = await c.env.DB.prepare(
      "INSERT INTO scheduled_posts (user_fb_id, page_id, message, image_url, scheduled_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(session.fb_id, targetPageId, post.message, post.image_url || null, post.scheduled_at).run();
    results.push({ id: meta.last_row_id as number, message: post.message.slice(0, 40), scheduled_at: post.scheduled_at });
  }

  return c.json({ ok: true, scheduled: results.length, total_requested: posts.length, results }, 201);
});

// GET /api/schedule + /api/posts/scheduled
schedule.get("/schedule", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { results } = await c.env.DB.prepare(
    "SELECT sp.*, up.page_name, up.picture_url as page_picture FROM scheduled_posts sp LEFT JOIN user_pages up ON sp.page_id = up.page_id AND sp.user_fb_id = up.user_fb_id WHERE sp.user_fb_id = ? ORDER BY sp.scheduled_at ASC"
  ).bind(session.fb_id).all();
  return c.json({ scheduled: results, total: results.length });
});

// DELETE /api/schedule/:id
schedule.delete("/schedule/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM scheduled_posts WHERE id = ? AND status = 'pending' AND user_fb_id = ?").bind(id, session.fb_id).run();
  return c.json({ ok: true });
});

// Cron handler (exported for use in worker.ts)
export async function processScheduledPosts(env: Env) {
  const now = new Date().toISOString();
  console.log(`[cron] checking scheduled posts at ${now}`);
  const encKey = env.TOKEN_ENCRYPTION_KEY || env.FB_APP_SECRET;
  const { results: pending } = await env.DB.prepare(
    "SELECT sp.*, up.page_token FROM scheduled_posts sp JOIN user_pages up ON sp.user_fb_id = up.user_fb_id AND sp.page_id = up.page_id WHERE sp.status = 'pending' AND sp.scheduled_at <= ? LIMIT 10"
  ).bind(now).all();
  console.log(`[cron] found ${pending.length} pending posts`);

  for (const post of pending as any[]) {
    if (!post.page_token) {
      await env.DB.prepare("UPDATE scheduled_posts SET status = 'failed' WHERE id = ?").bind(post.id).run();
      continue;
    }
    try {
      // Decrypt token (supports both encrypted and plaintext for migration)
      const pageToken = await decryptToken(post.page_token, encKey);
      let result: any;
      if (post.image_url) {
        const res = await fetch(`https://graph.facebook.com/v25.0/${post.page_id}/photos`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: post.image_url, message: post.message, access_token: pageToken }),
        });
        result = await res.json();
      } else {
        const res = await fetch(`https://graph.facebook.com/v25.0/${post.page_id}/feed`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: post.message, access_token: pageToken }),
        });
        result = await res.json();
      }
      if (result.error) {
        await env.DB.prepare("UPDATE scheduled_posts SET status = 'failed', error_message = ? WHERE id = ?").bind(JSON.stringify(result.error).slice(0, 500), post.id).run();
      } else {
        const fbPostId = result.id || result.post_id || null;
        await env.DB.prepare("UPDATE scheduled_posts SET status = 'posted', fb_post_id = ? WHERE id = ?").bind(fbPostId, post.id).run();
        try {
          await env.DB.prepare(
            "INSERT INTO posts (message, image_url, fb_post_id, page_id, user_fb_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'posted', ?)"
          ).bind(post.message, post.image_url, fbPostId, post.page_id, post.user_fb_id, new Date().toISOString()).run();
        } catch {
          // posts table insert is non-critical — scheduled_posts status already updated
        }
      }
    } catch (e) {
      await env.DB.prepare("UPDATE scheduled_posts SET status = 'failed', error_message = ? WHERE id = ?").bind(String(e).slice(0, 500), post.id).run();
    }
  }
}

export default schedule;
