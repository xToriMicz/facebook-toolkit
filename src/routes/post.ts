import { Hono } from "hono";
import { Env, getSessionFromReq, rateLimit, sanitize, kvCache, getUserPageId, getUserPageToken, getDecryptedPageToken, decryptToken } from "../helpers";

const post = new Hono<{ Bindings: Env }>();

// POST /api/post — create Facebook page post (single/multi-photo/text)
post.post("/post", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  if (await rateLimit(c.env.KV, `post:${session.fb_id}`, 50)) {
    return c.json({ error: "Rate limit: max 50 posts/hour" }, 429);
  }

  const body = await c.req.json() as any;
  const message = body.message ? sanitize(body.message) : "";
  const image_url = body.image_url;
  const image_urls = body.image_urls;
  const video_url = body.video_url;
  const page_id = body.page_id;
  const affiliate_link = body.affiliate_link ? sanitize(body.affiliate_link) : null;
  console.log("[post] received:", JSON.stringify({ message: message?.slice(0, 50), image_url, image_urls, video_url, page_id }));
  if (!message && !image_url && !image_urls?.length && !video_url) return c.json({ error: "message, image or video required" }, 400);
  if (message && message.length > 5000) return c.json({ error: "message too long (max 5000)" }, 400);

  const targetPageId = page_id || await getUserPageId(c.env.KV, session.fb_id);
  if (!targetPageId) return c.json({ error: "No page selected" }, 400);

  const encKey = c.env.TOKEN_ENCRYPTION_KEY || c.env.FB_APP_SECRET;
  const pageToken = await getDecryptedPageToken(c.env.DB, session.fb_id, targetPageId, encKey);
  const pageRow = await c.env.DB.prepare(
    "SELECT page_name FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, targetPageId).first<{ page_name: string }>();
  if (!pageToken || !pageRow) return c.json({ error: "Page not found or token missing." }, 400);
  const page = { page_token: pageToken, page_name: pageRow.page_name };

  try {
    let result: any;

    // Video post: use /{page_id}/videos endpoint
    if (video_url) {
      console.log("[post] video URL:", video_url);
      const res = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/videos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_url: video_url, description: message || "", access_token: page.page_token }),
      });
      result = await res.json();
      console.log("[post] FB video response:", JSON.stringify(result).slice(0, 300));
      if (!result.error) {
        const fbPostId = result.id || null;
        await c.env.DB.prepare(
          "INSERT INTO posts (message, image_url, fb_post_id, page_id, user_fb_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'posted', ?)"
        ).bind(message || "", video_url, fbPostId, targetPageId, session.fb_id, new Date().toISOString()).run();
        return c.json({ ok: true, result, page_name: page.page_name });
      }
      return c.json({ error: result.error?.message || "Video post failed", fb_error: result.error }, 400);
    }

    const urls = image_urls || (image_url ? [image_url] : []);

    if (urls.length > 1) {
      const photoResults = await Promise.all(urls.map(async (url: string, idx: number) => {
        const res = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/photos`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, published: false, access_token: page.page_token }),
        });
        return await res.json() as any;
      }));

      const validIds = photoResults.filter((d: any) => d.id).map((d: any) => d.id);
      const errors = photoResults.filter((d: any) => d.error);

      if (validIds.length < 2) {
        return c.json({ error: `Multi-photo upload failed: ${errors[0]?.error?.message || "unknown"}`, photo_errors: errors.map((e: any) => e.error?.message) }, 400);
      }

      const parts = [`message=${encodeURIComponent(message || "")}`, `access_token=${encodeURIComponent(page.page_token)}`];
      validIds.forEach((id: string, i: number) => {
        parts.push(`attached_media[${i}]=${encodeURIComponent(JSON.stringify({ media_fbid: id }))}`);
      });

      const res = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/feed`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: parts.join("&"),
      });
      result = await res.json();
    } else if (urls.length === 1) {
      console.log("[post] single photo URL:", urls[0]);
      const fbBody = { url: urls[0], message: message || "", access_token: page.page_token };
      const res = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/photos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fbBody),
      });
      result = await res.json();
      console.log("[post] FB response:", JSON.stringify(result).slice(0, 300));
    } else {
      const res = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/feed`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, access_token: page.page_token }),
      });
      result = await res.json();
    }

    if (result.error) return c.json({ error: result.error.message, fb_error: result.error }, 400);

    const fbPostId = result.id || result.post_id || null;
    await c.env.DB.prepare(
      "INSERT INTO posts (message, image_url, fb_post_id, page_id, user_fb_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'posted', ?)"
    ).bind(message || "", image_url || null, fbPostId, targetPageId, session.fb_id, new Date().toISOString()).run();

    let commentResult = null;
    if (affiliate_link && fbPostId) {
      try {
        const commentRes = await fetch(`https://graph.facebook.com/v25.0/${fbPostId}/comments`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: affiliate_link, access_token: page.page_token }),
        });
        commentResult = await commentRes.json();
      } catch {}
    }

    return c.json({ ok: true, result, page_name: page.page_name, auto_comment: commentResult });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/upload — upload image to R2
post.post("/upload", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  if (!file) return c.json({ error: "No file" }, 400);
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return c.json({ error: "Only image or video files allowed" }, 400);
  const maxSize = file.type.startsWith("video/") ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
  if (file.size > maxSize) return c.json({ error: `File too large (max ${file.type.startsWith("video/") ? "100MB" : "10MB"})` }, 400);

  const key = `uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "")}`;
  await c.env.ASSETS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  return c.json({ ok: true, url: `https://fb.makeloops.xyz/img/${key}`, key });
});

// GET /api/posts — post history with page info + optional engagement
post.get("/posts", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const limit = Math.min(50, +(c.req.query("limit") || "20"));
  const pageFilter = c.req.query("page_id");
  const withEngagement = c.req.query("engagement") === "1";

  let query = "SELECT p.*, up.page_name, up.page_id as matched_page_id FROM posts p LEFT JOIN user_pages up ON p.page_id = up.page_id AND up.user_fb_id = ?";
  const params: (string | number)[] = [session.fb_id];
  // Strict user isolation — only show posts belonging to this user
  query += " WHERE (p.user_fb_id = ? OR (p.user_fb_id IS NULL AND p.page_id IN (SELECT page_id FROM user_pages WHERE user_fb_id = ?)))";
  params.push(session.fb_id, session.fb_id);
  if (pageFilter) {
    query += " AND p.page_id = ?";
    params.push(pageFilter);
  }
  query += " ORDER BY p.created_at DESC LIMIT ?";
  params.push(limit);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();

  // Get unique pages for filter dropdown (user's pages only)
  const { results: pages } = await c.env.DB.prepare(
    "SELECT DISTINCT p.page_id, up.page_name FROM posts p LEFT JOIN user_pages up ON p.page_id = up.page_id WHERE p.page_id IS NOT NULL AND up.user_fb_id = ?"
  ).bind(session.fb_id).all();

  if (withEngagement && results.length > 0) {
    const encKey = c.env.TOKEN_ENCRYPTION_KEY || c.env.FB_APP_SECRET;
    const enriched = await Promise.all(results.map(async (post: any) => {
      if (!post.fb_post_id || !post.page_id) return { ...post, engagement: null };
      const token = await getDecryptedPageToken(c.env.DB, session.fb_id, post.page_id, encKey);
      if (!token) return { ...post, engagement: null };
      const eng = await kvCache(c.env.KV, `eng:${post.fb_post_id}`, 300, async () => {
        try {
          const res = await fetch(
            `https://graph.facebook.com/v25.0/${post.fb_post_id}?fields=reactions.summary(true),comments.summary(true),shares&access_token=${token}`
          );
          const data = await res.json() as any;
          if (data.error) return null;
          return { likes: data.reactions?.summary?.total_count || 0, comments: data.comments?.summary?.total_count || 0, shares: data.shares?.count || 0 };
        } catch { return null; }
      });
      return { ...post, engagement: eng };
    }));
    return c.json({ posts: enriched, total: enriched.length, pages });
  }
  return c.json({ posts: results, total: results.length, pages });
});

// GET /api/posts/:postId/comments
post.get("/posts/:postId/comments", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const postId = c.req.param("postId");
  const encKey = c.env.TOKEN_ENCRYPTION_KEY || c.env.FB_APP_SECRET;
  const token = await getUserPageToken(c.env.KV, session.fb_id, encKey);
  if (!token) return c.json({ error: "No page token" }, 400);
  try {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${postId}/comments?fields=id,message,from,created_time&order=reverse_chronological&access_token=${token}`
    );
    const data = await res.json() as any;
    if (data.error) return c.json({ error: data.error.message }, 400);
    return c.json({ ok: true, comments: data.data || [], paging: data.paging });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// POST /api/posts/:postId/reply
post.post("/posts/:postId/reply", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const commentId = c.req.param("postId");
  const { message: rawMsg } = await c.req.json() as { message: string };
  const message = rawMsg ? sanitize(rawMsg) : "";
  if (!message) return c.json({ error: "message required" }, 400);
  const encKey = c.env.TOKEN_ENCRYPTION_KEY || c.env.FB_APP_SECRET;
  const token = await getUserPageToken(c.env.KV, session.fb_id, encKey);
  if (!token) return c.json({ error: "No page token" }, 400);
  try {
    const res = await fetch(`https://graph.facebook.com/v25.0/${commentId}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: token }),
    });
    const data = await res.json() as any;
    if (data.error) return c.json({ error: data.error.message }, 400);
    return c.json({ ok: true, id: data.id });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// POST /api/posts/:postId/auto-comment
post.post("/posts/:postId/auto-comment", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const postId = c.req.param("postId");
  const { message: rawMsg2 } = await c.req.json() as { message: string };
  const message = rawMsg2 ? sanitize(rawMsg2) : "";
  if (!message) return c.json({ error: "message required" }, 400);
  const encKey = c.env.TOKEN_ENCRYPTION_KEY || c.env.FB_APP_SECRET;
  const token = await getUserPageToken(c.env.KV, session.fb_id, encKey);
  if (!token) return c.json({ error: "No page token" }, 400);
  try {
    const res = await fetch(`https://graph.facebook.com/v25.0/${postId}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: token }),
    });
    const data = await res.json() as any;
    if (data.error) return c.json({ error: data.error.message }, 400);
    await c.env.DB.prepare(
      "INSERT INTO activity_logs (user_fb_id, action, detail, post_id) VALUES (?, 'auto_comment', ?, ?)"
    ).bind(session.fb_id, message.substring(0, 200), postId).run();
    return c.json({ ok: true, id: data.id });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

export default post;
