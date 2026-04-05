import { Hono } from "hono";
import { Env, getSessionFromReq, getUserPageId, decryptToken } from "../helpers";

const schedule = new Hono<{ Bindings: Env }>();

// POST /api/schedule + /api/post/schedule
schedule.post("/schedule", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { page_id, message, image_url, image_urls, scheduled_at } = await c.req.json();
  if (!message || !scheduled_at) return c.json({ error: "message and scheduled_at required" }, 400);

  const targetPageId = page_id || await getUserPageId(c.env.KV, session.fb_id);
  if (!targetPageId) return c.json({ error: "No page selected" }, 400);

  const page = await c.env.DB.prepare(
    "SELECT page_id FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, targetPageId).first();
  if (!page) return c.json({ error: "Page not found for this user" }, 400);

  // Normalize: image_urls array takes priority, fallback to image_url as single-item array
  const normalizedUrls = Array.isArray(image_urls) && image_urls.length > 0
    ? image_urls
    : (image_url ? [image_url] : null);

  const { meta } = await c.env.DB.prepare(
    "INSERT INTO scheduled_posts (user_fb_id, page_id, message, image_url, image_urls, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(
    session.fb_id,
    targetPageId,
    message,
    image_url || (normalizedUrls ? normalizedUrls[0] : null),
    normalizedUrls ? JSON.stringify(normalizedUrls) : null,
    scheduled_at
  ).run();

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

    const normalizedUrls = Array.isArray(post.image_urls) && post.image_urls.length > 0
      ? post.image_urls
      : (post.image_url ? [post.image_url] : null);

    const { meta } = await c.env.DB.prepare(
      "INSERT INTO scheduled_posts (user_fb_id, page_id, message, image_url, image_urls, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      session.fb_id,
      targetPageId,
      post.message,
      post.image_url || (normalizedUrls ? normalizedUrls[0] : null),
      normalizedUrls ? JSON.stringify(normalizedUrls) : null,
      post.scheduled_at
    ).run();
    results.push({ id: meta.last_row_id as number, message: post.message.slice(0, 40), scheduled_at: post.scheduled_at });
  }

  return c.json({ ok: true, scheduled: results.length, total_requested: posts.length, results }, 201);
});

// GET /api/schedule + /api/posts/scheduled
schedule.get("/schedule", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const pageId = c.req.query("page_id");
  let q = "SELECT sp.*, up.page_name, up.picture_url as page_picture FROM scheduled_posts sp LEFT JOIN user_pages up ON sp.page_id = up.page_id AND sp.user_fb_id = up.user_fb_id WHERE sp.user_fb_id = ? AND sp.status IN ('pending', 'posting', 'failed')";
  const binds: any[] = [session.fb_id];
  if (pageId) { q += " AND sp.page_id = ?"; binds.push(pageId); }
  q += " ORDER BY sp.scheduled_at ASC";
  const { results } = await c.env.DB.prepare(q).bind(...binds).all();
  return c.json({ scheduled: results, posts: results, total: results.length });
});

// PUT /api/schedule/:id — update pending scheduled post
schedule.put("/schedule/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  const { message, image_url, image_urls, scheduled_at } = await c.req.json();

  const existing = await c.env.DB.prepare(
    "SELECT id FROM scheduled_posts WHERE id = ? AND status = 'pending' AND user_fb_id = ?"
  ).bind(id, session.fb_id).first();
  if (!existing) return c.json({ error: "Post not found or already posted" }, 404);

  const updates: string[] = [];
  const values: any[] = [];
  if (message !== undefined) { updates.push("message = ?"); values.push(message); }
  if (image_url !== undefined) { updates.push("image_url = ?"); values.push(image_url || null); }
  if (image_urls !== undefined) {
    const normalizedUrls = Array.isArray(image_urls) && image_urls.length > 0 ? image_urls : null;
    updates.push("image_urls = ?");
    values.push(normalizedUrls ? JSON.stringify(normalizedUrls) : null);
    // Sync image_url with first URL for backward compatibility
    if (image_url === undefined) {
      updates.push("image_url = ?");
      values.push(normalizedUrls ? normalizedUrls[0] : null);
    }
  }
  if (scheduled_at !== undefined) { updates.push("scheduled_at = ?"); values.push(scheduled_at); }
  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);

  values.push(id, session.fb_id);
  await c.env.DB.prepare(
    `UPDATE scheduled_posts SET ${updates.join(", ")} WHERE id = ? AND user_fb_id = ?`
  ).bind(...values).run();

  return c.json({ ok: true });
});

// DELETE /api/schedule/:id
schedule.delete("/schedule/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM scheduled_posts WHERE id = ? AND status IN ('pending', 'failed') AND user_fb_id = ?").bind(id, session.fb_id).run();
  return c.json({ ok: true });
});

// POST /api/schedule/:id/retry — retry a failed scheduled post
schedule.post("/schedule/:id/retry", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  // Reset failed post to pending with new schedule time (now + 1 min)
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  const result = await c.env.DB.prepare(
    "UPDATE scheduled_posts SET status = 'pending', error_message = NULL, scheduled_at = ? WHERE id = ? AND status = 'failed' AND user_fb_id = ?"
  ).bind(retryAt, id, session.fb_id).run();
  if (!result.meta.changes) return c.json({ error: "Post not found or not failed" }, 404);
  return c.json({ ok: true, retry_at: retryAt });
});

// Cron handler (exported for use in worker.ts)
export async function processScheduledPosts(env: Env) {
  const now = new Date().toISOString();
  console.log(`[cron] checking scheduled posts at ${now}`);
  const encKey = env.TOKEN_ENCRYPTION_KEY || env.FB_APP_SECRET;

  // Safety: reset stuck 'posting' posts back to pending — only if no fb_post_id (not yet posted)
  await env.DB.prepare(
    "UPDATE scheduled_posts SET status = 'pending' WHERE status = 'posting' AND fb_post_id IS NULL AND scheduled_at <= datetime(?, '-30 minutes')"
  ).bind(now).run();

  const { results: pending } = await env.DB.prepare(
    "SELECT sp.*, up.page_token FROM scheduled_posts sp JOIN user_pages up ON sp.user_fb_id = up.user_fb_id AND sp.page_id = up.page_id WHERE sp.status = 'pending' AND sp.scheduled_at <= ? LIMIT 10"
  ).bind(now).all();
  console.log(`[cron] found ${pending.length} pending posts`);

  for (const post of pending as any[]) {
    if (!post.page_token) {
      await env.DB.prepare("UPDATE scheduled_posts SET status = 'failed' WHERE id = ?").bind(post.id).run();
      continue;
    }
    // Lock: claim this post before processing — prevents double-post from concurrent cron ticks
    const lock = await env.DB.prepare(
      "UPDATE scheduled_posts SET status = 'posting' WHERE id = ? AND status = 'pending'"
    ).bind(post.id).run();
    if (!lock.meta.changes) {
      console.log(`[cron] post ${post.id} already claimed — skipping`);
      continue;
    }
    try {
      const pageToken = await decryptToken(post.page_token, encKey);
      let result: any;

      // Parse image_urls from DB (JSON array string), fallback to image_url
      const urls: string[] = post.image_urls
        ? JSON.parse(post.image_urls)
        : (post.image_url ? [post.image_url] : []);

      if (urls.length > 1) {
        // Multi-photo flow: upload unpublished photos → attach to feed post
        const photoResults = await Promise.all(urls.map(async (url: string) => {
          const res = await fetch(`https://graph.facebook.com/v25.0/${post.page_id}/photos`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, published: false, access_token: pageToken }),
          });
          return await res.json() as any;
        }));

        const validIds = photoResults.filter((d: any) => d.id).map((d: any) => d.id);
        const errors = photoResults.filter((d: any) => d.error);

        if (validIds.length < 2) {
          const errMsg = `Multi-photo upload failed: ${errors[0]?.error?.message || "unknown"} (${validIds.length}/${urls.length} uploaded)`;
          await env.DB.prepare("UPDATE scheduled_posts SET status = 'failed', error_message = ? WHERE id = ?").bind(errMsg.slice(0, 500), post.id).run();
          continue;
        }

        // Post to feed with attached_media
        const parts = [
          `message=${encodeURIComponent(post.message || "")}`,
          `access_token=${encodeURIComponent(pageToken)}`
        ];
        validIds.forEach((id: string, i: number) => {
          parts.push(`attached_media[${i}]=${encodeURIComponent(JSON.stringify({ media_fbid: id }))}`);
        });

        const res = await fetch(`https://graph.facebook.com/v25.0/${post.page_id}/feed`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: parts.join("&"),
        });
        result = await res.json();
      } else if (urls.length === 1) {
        // Single photo
        const res = await fetch(`https://graph.facebook.com/v25.0/${post.page_id}/photos`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urls[0], message: post.message, access_token: pageToken }),
        });
        result = await res.json();
      } else {
        // Text only
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
          // posts table insert is non-critical
        }
        // Notification: scheduled post success
        try {
          const { createNotification } = await import("./notifications");
          await createNotification(env.DB, post.user_fb_id, {
            page_id: post.page_id, type: "scheduled", priority: "important",
            title: "⏰ โพสตั้งเวลาส่งแล้ว",
            detail: (post.message || "").slice(0, 100),
            link: `?page=${post.page_id}&tab=activityLog`,
            source_id: fbPostId,
          });
        } catch { /* non-critical */ }
      }
    } catch (e) {
      await env.DB.prepare("UPDATE scheduled_posts SET status = 'failed', error_message = ? WHERE id = ?").bind(String(e).slice(0, 500), post.id).run();
      // Notification: scheduled post failed
      try {
        const { createNotification } = await import("./notifications");
        await createNotification(env.DB, post.user_fb_id, {
          page_id: post.page_id, type: "error", priority: "urgent",
          title: "❌ โพสตั้งเวลาล้มเหลว",
          detail: String(e).slice(0, 100),
          link: `?page=${post.page_id}&tab=schedule`,
        });
      } catch { /* non-critical */ }
    }
  }
}

export default schedule;
