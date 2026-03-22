import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/cloudflare-workers";
import auth, { getSession } from "./auth";
import { getCookie } from "hono/cookie";
import { callAI } from "./ai-providers";

interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  KV: KVNamespace;
  FB_APP_SECRET: string;
  ANTHROPIC_API_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();

// Security + cache headers
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  const path = c.req.path;
  if (path.startsWith("/api/")) {
    c.header("Cache-Control", "private, max-age=0");
  } else if (path.startsWith("/img/")) {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  }
});

// KV cache helper (read-through cache)
async function kvCache<T>(kv: KVNamespace, key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = await kv.get(key);
  if (cached) return JSON.parse(cached) as T;
  const data = await fetcher();
  await kv.put(key, JSON.stringify(data), { expirationTtl: ttl });
  return data;
}

// Rate limiter per hour: returns true if over limit
async function rateLimit(kv: KVNamespace, key: string, maxPerHour: number): Promise<boolean> {
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const k = `rl:${key}:${hour}`;
  const count = parseInt(await kv.get(k) || "0");
  if (count >= maxPerHour) return true;
  await kv.put(k, String(count + 1), { expirationTtl: 3600 });
  return false;
}

// Sanitize input: strip script tags and event handlers
function sanitize(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/<\/?script[^>]*>/gi, "");
}

// CSRF: verify Origin for mutation requests
app.use("/api/*", async (c, next) => {
  if (c.req.method === "POST" || c.req.method === "DELETE") {
    const origin = c.req.header("origin") || c.req.header("referer") || "";
    if (origin && !origin.startsWith("https://fb.makeloops.xyz")) {
      return c.json({ error: "Invalid origin" }, 403);
    }
  }
  await next();
});

app.use("/api/*", cors({
  origin: "https://fb.makeloops.xyz",
  credentials: true,
}));

// Auth routes: /auth/facebook, /auth/callback, /auth/logout, /api/me, /api/pages
app.route("/auth", auth);
app.route("/", auth);

// Helper: get session from cookie in worker routes
async function getSessionFromReq(c: any): Promise<any | null> {
  const sessionId = getCookie(c, "session");
  if (!sessionId) return null;
  const data = await c.env.KV.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

// Favicon — prevent __STATIC_CONTENT_MANIFEST error
app.get("/favicon.ico", (c) => {
  return new Response(null, { status: 204, headers: { "Cache-Control": "public, max-age=86400" } });
});

// Health check
app.get("/api/health", (c) => c.json({ ok: true, service: "facebook-toolkit" }));

// --- Facebook Page Post (reads token from user_pages via session) ---
app.post("/api/post", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  if (await rateLimit(c.env.KV, `post:${session.fb_id}`, 50)) {
    return c.json({ error: "Rate limit: max 50 posts/hour" }, 429);
  }

  const { message, image_url, image_urls, page_id, affiliate_link } = await c.req.json();
  if (!message && !image_url && !image_urls?.length) return c.json({ error: "message or image required" }, 400);
  if (message && message.length > 5000) return c.json({ error: "message too long (max 5000)" }, 400);

  const targetPageId = page_id || await c.env.KV.get("fb_page_id");
  if (!targetPageId) return c.json({ error: "No page selected" }, 400);

  const page = await c.env.DB.prepare(
    "SELECT page_token, page_name FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, targetPageId).first<{ page_token: string; page_name: string }>();

  if (!page?.page_token) {
    return c.json({ error: "Page not found or token missing." }, 400);
  }

  try {
    let result: any;
    const urls = image_urls || (image_url ? [image_url] : []);
    console.log("[post] urls:", urls.length, "page:", targetPageId);

    if (urls.length > 1) {
      // Multi-photo: upload each unpublished, then create feed post
      const photoResults = await Promise.all(urls.map(async (url: string, idx: number) => {
        const res = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, published: false, access_token: page.page_token }),
        });
        const data = await res.json() as any;
        console.log(`[post] photo ${idx}: id=${data.id}, error=${data.error?.message || 'none'}`);
        return data;
      }));

      const validIds = photoResults.filter((d: any) => d.id).map((d: any) => d.id);
      const errors = photoResults.filter((d: any) => d.error);
      console.log("[post] validIds:", validIds.length, "errors:", errors.length);

      if (validIds.length < 2) {
        const errMsg = errors[0]?.error?.message || "Failed to upload photos";
        return c.json({ error: `Multi-photo upload failed: ${errMsg}`, photo_errors: errors.map((e: any) => e.error?.message) }, 400);
      }

      // Build form body manually — URLSearchParams encodes brackets wrong
      const parts = [`message=${encodeURIComponent(message || "")}`, `access_token=${encodeURIComponent(page.page_token)}`];
      validIds.forEach((id: string, i: number) => {
        parts.push(`attached_media[${i}]=${encodeURIComponent(JSON.stringify({ media_fbid: id }))}`);
      });

      const feedBody = parts.join("&");
      console.log("[post] feed body length:", feedBody.length, "media count:", validIds.length);

      const res = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: feedBody,
      });
      result = await res.json();
      console.log("[post] feed result:", JSON.stringify(result).substring(0, 200));
    } else if (urls.length === 1) {
      // Single photo post (direct to Facebook, skip R2 for speed)
      const res = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urls[0], message: message || "", access_token: page.page_token }),
      });
      result = await res.json();
    } else {
      // Text-only
      const res = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, access_token: page.page_token }),
      });
      result = await res.json();
    }

    if (result.error) {
      return c.json({ error: result.error.message, fb_error: result.error }, 400);
    }

    const fbPostId = result.id || result.post_id || null;
    await c.env.DB.prepare(
      "INSERT INTO posts (message, image_url, fb_post_id, status, created_at) VALUES (?, ?, ?, 'posted', ?)"
    ).bind(message || "", image_url || null, fbPostId, new Date().toISOString()).run();

    // Auto-comment affiliate link (keeps link out of caption for better reach)
    let commentResult = null;
    if (affiliate_link && fbPostId) {
      try {
        const commentRes = await fetch(`https://graph.facebook.com/v25.0/${fbPostId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

// --- Upload image to R2 (image/* only, max 10MB) ---
app.post("/api/upload", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  if (!file) return c.json({ error: "No file" }, 400);
  if (!file.type.startsWith("image/")) return c.json({ error: "Only image files allowed" }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: "File too large (max 10MB)" }, 400);

  const key = `uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "")}`;
  await c.env.ASSETS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  const url = `https://fb.makeloops.xyz/img/${key}`;
  return c.json({ ok: true, url, key });
});

// --- Serve R2 images ---
app.get("/img/*", async (c) => {
  const key = c.req.path.replace("/img/", "");
  const obj = await c.env.ASSETS.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  headers.set("Content-Type", obj.httpMetadata?.contentType || "image/jpeg");
  headers.set("Cache-Control", "public, max-age=31536000");
  return new Response(obj.body, { headers });
});

// --- Post history (auth required) ---
app.get("/api/posts", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const limit = Math.min(50, +(c.req.query("limit") || "20"));
  const withEngagement = c.req.query("engagement") === "1";

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM posts ORDER BY created_at DESC LIMIT ?"
  ).bind(limit).all();

  if (withEngagement && results.length > 0) {
    const token = await c.env.KV.get("fb_page_token");
    if (token) {
      const enriched = await Promise.all(results.map(async (post: any) => {
        if (!post.fb_post_id) return { ...post, engagement: null };
        // Cache engagement in KV for 5 minutes
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
      return c.json({ posts: enriched, total: enriched.length });
    }
  }

  return c.json({ posts: results, total: results.length });
});

// --- Settings (token management) ---
app.get("/api/settings", async (c) => {
  const [pageId, pageToken, pageName] = await Promise.all([
    c.env.KV.get("fb_page_id"),
    c.env.KV.get("fb_page_token"),
    c.env.KV.get("fb_page_name"),
  ]);
  return c.json({ page_id: pageId, page_name: pageName, has_token: !!pageToken });
});

app.post("/api/settings", async (c) => {
  const { page_id, page_token, page_name } = await c.req.json();
  if (page_id) await c.env.KV.put("fb_page_id", page_id);
  if (page_token) await c.env.KV.put("fb_page_token", page_token);
  if (page_name) await c.env.KV.put("fb_page_name", page_name);
  return c.json({ ok: true });
});

// --- Page Insights ---
app.get("/api/insights/:pageId", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const pageId = c.req.param("pageId");
  const page = await c.env.DB.prepare(
    "SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, pageId).first<{ page_token: string }>();
  if (!page?.page_token) return c.json({ error: "Page not found" }, 404);

  try {
    const metrics = "page_impressions,page_engaged_users,page_post_engagements,page_fan_adds";
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${pageId}/insights?metric=${metrics}&period=day&access_token=${page.page_token}`
    );
    const data = await res.json() as any;
    if (data.error) return c.json({ error: data.error.message }, 400);
    return c.json({ ok: true, insights: data.data || [] });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Post Comments ---
app.get("/api/posts/:postId/comments", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const postId = c.req.param("postId");
  const token = await c.env.KV.get("fb_page_token");
  if (!token) return c.json({ error: "No page token" }, 400);

  try {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${postId}/comments?fields=id,message,from,created_time&order=reverse_chronological&access_token=${token}`
    );
    const data = await res.json() as any;
    if (data.error) return c.json({ error: data.error.message }, 400);
    return c.json({ ok: true, comments: data.data || [], paging: data.paging });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post("/api/posts/:postId/reply", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const commentId = c.req.param("postId"); // actually comment ID
  const { message } = await c.req.json() as { message: string };
  if (!message) return c.json({ error: "message required" }, 400);

  const token = await c.env.KV.get("fb_page_token");
  if (!token) return c.json({ error: "No page token" }, 400);

  try {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${commentId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, access_token: token }),
      }
    );
    const data = await res.json() as any;
    if (data.error) return c.json({ error: data.error.message }, 400);
    return c.json({ ok: true, id: data.id });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Auto-comment on post ---
app.post("/api/posts/:postId/auto-comment", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const postId = c.req.param("postId");
  const { message } = await c.req.json() as { message: string };
  if (!message) return c.json({ error: "message required" }, 400);

  const token = await c.env.KV.get("fb_page_token");
  if (!token) return c.json({ error: "No page token" }, 400);

  try {
    const res = await fetch(`https://graph.facebook.com/v25.0/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: token }),
    });
    const data = await res.json() as any;
    if (data.error) return c.json({ error: data.error.message }, 400);

    await c.env.DB.prepare(
      "INSERT INTO activity_logs (user_fb_id, action, detail, post_id) VALUES (?, 'auto_comment', ?, ?)"
    ).bind(session.fb_id, message.substring(0, 200), postId).run();

    return c.json({ ok: true, id: data.id });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Activity logs / notifications ---
app.get("/api/activity", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM activity_logs WHERE user_fb_id = ? ORDER BY created_at DESC LIMIT 20"
  ).bind(session.fb_id).all();
  return c.json({ activities: results, total: results.length });
});

// --- Webhook for Facebook (comment notifications) ---
app.get("/webhook", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  if (mode === "subscribe" && token === "fb_toolkit_verify_2026") {
    return c.text(challenge || "", 200);
  }
  return c.text("Forbidden", 403);
});

app.post("/webhook", async (c) => {
  try {
    const body = await c.req.json() as any;
    if (body.object === "page" && body.entry) {
      for (const entry of body.entry) {
        for (const change of entry.changes || []) {
          if (change.field === "feed" && change.value?.item === "comment") {
            await c.env.DB.prepare(
              "INSERT INTO activity_logs (user_fb_id, action, detail, post_id) VALUES (?, 'new_comment', ?, ?)"
            ).bind(
              entry.id,
              `${change.value.from?.name || "Someone"}: ${(change.value.message || "").substring(0, 200)}`,
              change.value.post_id || null
            ).run();
          }
        }
      }
    }
  } catch {}
  return c.text("EVENT_RECEIVED", 200);
});

// --- AI Settings ---
app.get("/api/ai-settings", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const row = await c.env.DB.prepare(
    "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
  ).bind(session.fb_id).first<{ provider: string; model: string; api_key: string; endpoint_url: string }>();

  if (!row) return c.json({ configured: false });

  return c.json({
    configured: true,
    provider: row.provider,
    model: row.model,
    api_key_preview: row.api_key ? row.api_key.slice(0, 8) + "****" : null,
    endpoint_url: row.endpoint_url,
  });
});

app.post("/api/ai-settings", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { provider, model, api_key, endpoint_url } = await c.req.json() as any;
  if (!provider) return c.json({ error: "provider required" }, 400);

  const defaults: Record<string, { model: string; endpoint: string }> = {
    anthropic: { model: "claude-haiku-4-5-20251001", endpoint: "https://api.anthropic.com/v1/messages" },
    openai: { model: "gpt-4o-mini", endpoint: "https://api.openai.com/v1/chat/completions" },
    google: { model: "gemini-2.0-flash", endpoint: "https://generativelanguage.googleapis.com/v1beta/models" },
  };
  const def = defaults[provider];

  await c.env.DB.prepare(
    `INSERT INTO user_ai_settings (user_fb_id, provider, model, api_key, endpoint_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_fb_id) DO UPDATE SET
       provider = excluded.provider, model = excluded.model,
       api_key = excluded.api_key, endpoint_url = excluded.endpoint_url`
  ).bind(
    session.fb_id,
    provider,
    model || def?.model || "",
    api_key || "",
    endpoint_url || def?.endpoint || "",
    new Date().toISOString()
  ).run();

  return c.json({ ok: true });
});

// --- AI Content Writer ---
app.post("/api/ai-write", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  if (await rateLimit(c.env.KV, `ai:${session.fb_id}`, 100)) {
    return c.json({ error: "Rate limit: max 100 AI writes/hour" }, 429);
  }

  const { topic, tone, format } = await c.req.json() as { topic?: string; tone?: string; format?: string };
  if (!topic) return c.json({ error: "topic required" }, 400);
  if (topic.length > 2000) return c.json({ error: "topic too long (max 2000)" }, 400);

  const toneMap: Record<string, string> = {
    "สนุก": "สนุกสนาน ใช้อีโมจิ เป็นกันเอง",
    "จริงจัง": "จริงจัง น่าเชื่อถือ เป็นทางการ",
    "ขายของ": "กระตุ้นให้ซื้อ มี CTA ชัดเจน เน้นประโยชน์",
    "ให้ความรู้": "ให้ข้อมูลที่เป็นประโยชน์ อธิบายง่าย",
  };
  const formatMap: Record<string, string> = {
    "สั้น": "1-2 บรรทัด สั้นกระชับ",
    "ปานกลาง": "3-5 บรรทัด",
    "ยาว": "6-10 บรรทัด ละเอียด",
  };

  const toneDesc = toneMap[tone || "สนุก"] || toneMap["สนุก"];
  const formatDesc = formatMap[format || "ปานกลาง"] || formatMap["ปานกลาง"];

  const systemPrompt = `คุณเป็น Social Media Content Writer มืออาชีพ เขียนเป็นภาษาไทย
กฎ:
- เขียน caption สำหรับโพส Facebook
- โทน: ${toneDesc}
- ความยาว: ${formatDesc}
- ใส่อีโมจิตามความเหมาะสม
- แนะนำ hashtag ภาษาไทย 3-5 อัน
- ตอบเป็น JSON: {"text":"caption ที่เขียน","hashtags":["#tag1","#tag2"]}
- ตอบ JSON เท่านั้น ไม่มีข้อความอื่น`;

  // Load user AI settings, fallback to env
  const aiSettings = await c.env.DB.prepare(
    "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
  ).bind(session.fb_id).first<{ provider: string; model: string; api_key: string; endpoint_url: string }>();

  const provider = aiSettings?.provider || "anthropic";
  const apiKey = aiSettings?.api_key || c.env.ANTHROPIC_API_KEY;
  const model = aiSettings?.model || "claude-haiku-4-5-20251001";
  const endpoint = aiSettings?.endpoint_url || "https://api.anthropic.com/v1/messages";

  if (!apiKey) return c.json({ error: "No API key configured. Go to Settings > AI to add one." }, 400);

  const userMsg = `เขียน caption Facebook เกี่ยวกับ: ${topic}`;

  try {
    let responseText = "";

    if (provider === "openai") {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }] }),
      });
      const data = await res.json() as any;
      if (data.error) return c.json({ error: data.error.message }, 500);
      responseText = data.choices?.[0]?.message?.content || "";
    } else if (provider === "google") {
      const res = await fetch(`${endpoint}/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMsg}` }] }] }),
      });
      const data = await res.json() as any;
      if (data.error) return c.json({ error: data.error.message }, 500);
      responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: "user", content: userMsg }], system: systemPrompt }),
      });
      const data = await res.json() as any;
      if (data.error) return c.json({ error: data.error.message }, 500);
      responseText = data.content?.[0]?.text || "";
    }

    // Strip markdown codeblock if present (```json...```)
    let cleaned = responseText.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
    }
    try {
      const parsed = JSON.parse(cleaned);
      return c.json({ ok: true, text: parsed.text || "", hashtags: parsed.hashtags || [], provider });
    } catch {
      return c.json({ ok: true, text: cleaned, hashtags: [], provider });
    }
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Content Templates ---
app.get("/api/templates", async (c) => {
  const category = c.req.query("category") || "all";
  const cacheKey = `tpl:${category}`;
  const data = await kvCache(c.env.KV, cacheKey, 600, async () => {
    let query = "SELECT * FROM content_templates";
    const params: string[] = [];
    if (category !== "all") { query += " WHERE category = ?"; params.push(category); }
    query += " ORDER BY created_at DESC";
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return { templates: results, total: results.length };
  });
  return c.json(data);
});

app.post("/api/templates", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { title, template_text, category } = await c.req.json();
  if (!title || !template_text) return c.json({ error: "title and template_text required" }, 400);
  const cat = sanitize(category || "ทั่วไป");
  const { meta } = await c.env.DB.prepare(
    "INSERT INTO content_templates (title, template_text, category) VALUES (?, ?, ?)"
  ).bind(sanitize(title), sanitize(template_text), cat).run();
  await c.env.KV.delete("tpl:all"); await c.env.KV.delete(`tpl:${cat}`);
  return c.json({ ok: true, id: meta.last_row_id }, 201);
});

app.delete("/api/templates/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM content_templates WHERE id = ?").bind(id).run();
  await c.env.KV.delete("tpl:all");
  return c.json({ ok: true });
});

// --- Reels (3-step: init, upload, publish) ---
app.post("/api/reels", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { video_url, description, page_id } = await c.req.json();
  if (!video_url) return c.json({ error: "video_url required" }, 400);

  const targetPageId = page_id || await c.env.KV.get("fb_page_id");
  if (!targetPageId) return c.json({ error: "No page selected" }, 400);
  const page = await c.env.DB.prepare(
    "SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, targetPageId).first<{ page_token: string }>();
  if (!page?.page_token) return c.json({ error: "Page token missing" }, 400);

  try {
    const initRes = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/video_reels`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_phase: "start", access_token: page.page_token }),
    });
    const initData: any = await initRes.json();
    if (initData.error) return c.json({ error: initData.error.message, step: "init" }, 400);
    const videoId = initData.video_id;

    const uploadRes = await fetch(`https://rupload.facebook.com/video-upload/v25.0/${videoId}`, {
      method: "POST",
      headers: { "Authorization": `OAuth ${page.page_token}`, "file_url": video_url },
    });
    const uploadData: any = await uploadRes.json();
    if (!uploadData.success) return c.json({ error: "Upload failed", step: "upload", detail: uploadData }, 400);

    const pubRes = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/video_reels`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId, upload_phase: "finish", video_state: "PUBLISHED",
        description: description || "", access_token: page.page_token }),
    });
    const pubData: any = await pubRes.json();
    if (pubData.error) return c.json({ error: pubData.error.message, step: "publish" }, 400);

    await c.env.DB.prepare(
      "INSERT INTO posts (message, fb_post_id, status, created_at) VALUES (?, ?, 'posted', ?)"
    ).bind("[Reel] " + (description || ""), pubData.id || videoId, new Date().toISOString()).run();

    return c.json({ ok: true, video_id: videoId, result: pubData });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// --- Stories ---
app.post("/api/stories", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { image_url, video_url, page_id } = await c.req.json();
  if (!image_url && !video_url) return c.json({ error: "image_url or video_url required" }, 400);

  const targetPageId = page_id || await c.env.KV.get("fb_page_id");
  if (!targetPageId) return c.json({ error: "No page selected" }, 400);
  const page = await c.env.DB.prepare(
    "SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, targetPageId).first<{ page_token: string }>();
  if (!page?.page_token) return c.json({ error: "Page token missing" }, 400);

  try {
    const isVideo = !!video_url;
    const endpoint = isVideo ? targetPageId + "/video_stories" : targetPageId + "/photo_stories";
    const body: any = { access_token: page.page_token };
    if (isVideo) body.video_url = video_url; else body.url = image_url;

    const res = await fetch("https://graph.facebook.com/v25.0/" + endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data: any = await res.json();
    if (data.error) return c.json({ error: data.error.message }, 400);

    await c.env.DB.prepare(
      "INSERT INTO posts (message, fb_post_id, status, created_at) VALUES (?, ?, 'posted', ?)"
    ).bind("[Story] " + (isVideo ? "Video" : "Photo"), data.id || data.post_id, new Date().toISOString()).run();

    return c.json({ ok: true, result: data });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// --- Drafts ---
app.post("/api/drafts", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { message, image_url, page_id } = await c.req.json();
  if (!message) return c.json({ error: "message required" }, 400);
  const { meta } = await c.env.DB.prepare(
    "INSERT INTO drafts (user_fb_id, page_id, message, image_url) VALUES (?, ?, ?, ?)"
  ).bind(session.fb_id, page_id || null, message, image_url || null).run();
  return c.json({ ok: true, id: meta.last_row_id }, 201);
});

app.get("/api/drafts", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM drafts WHERE user_fb_id = ? ORDER BY updated_at DESC"
  ).bind(session.fb_id).all();
  return c.json({ drafts: results, total: results.length });
});

app.put("/api/drafts/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  const { message, image_url, page_id } = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE drafts SET message = ?, image_url = ?, page_id = ?, updated_at = datetime('now') WHERE id = ? AND user_fb_id = ?"
  ).bind(message, image_url || null, page_id || null, id, session.fb_id).run();
  return c.json({ ok: true });
});

app.delete("/api/drafts/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM drafts WHERE id = ? AND user_fb_id = ?").bind(id, session.fb_id).run();
  return c.json({ ok: true });
});

app.post("/api/drafts/:id/publish", async (c) => {
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

// --- AI Provider Test ---
app.post("/api/ai-settings/test", async (c) => {
  const { provider, api_key, model, endpoint } = await c.req.json();
  if (!provider || !api_key || !model) {
    return c.json({ error: "provider, api_key, model required" }, 400);
  }
  try {
    const result = await callAI(provider, api_key, model, "Say hello in Thai, one sentence only.", endpoint);
    return c.json({ ok: true, provider, model: result.model, response: result.text, usage: result.usage });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 400);
  }
});

// --- Scheduled Posts ---
// Support both /api/schedule and /api/post/schedule
const scheduleHandler = async (c: any) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { page_id, message, image_url, scheduled_at } = await c.req.json();
  if (!message || !scheduled_at) {
    return c.json({ error: "message and scheduled_at required" }, 400);
  }

  const targetPageId = page_id || await c.env.KV.get("fb_page_id");
  if (!targetPageId) return c.json({ error: "No page selected" }, 400);

  // Verify page belongs to user
  const page = await c.env.DB.prepare(
    "SELECT page_id FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, targetPageId).first();
  if (!page) return c.json({ error: "Page not found for this user" }, 400);

  const { meta } = await c.env.DB.prepare(
    "INSERT INTO scheduled_posts (user_fb_id, page_id, message, image_url, scheduled_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(session.fb_id, targetPageId, message, image_url || null, scheduled_at).run();

  return c.json({ ok: true, id: meta.last_row_id }, 201);
};
app.post("/api/schedule", scheduleHandler);
app.post("/api/post/schedule", scheduleHandler);

const getScheduleHandler = async (c: any) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM scheduled_posts WHERE user_fb_id = ? ORDER BY scheduled_at ASC"
  ).bind(session.fb_id).all();
  return c.json({ scheduled: results, total: results.length });
};
app.get("/api/schedule", getScheduleHandler);
app.get("/api/posts/scheduled", getScheduleHandler);

app.delete("/api/schedule/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(
    "DELETE FROM scheduled_posts WHERE id = ? AND status = 'pending'"
  ).bind(id).run();
  return c.json({ ok: true });
});

// --- Performance Analytics ---
app.get("/api/analytics/performance", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  // Top posts by engagement
  const { results: topPosts } = await c.env.DB.prepare(
    "SELECT *, (COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as engagement FROM posts WHERE status = 'posted' ORDER BY engagement DESC LIMIT 10"
  ).all();

  // Worst posts
  const { results: worstPosts } = await c.env.DB.prepare(
    "SELECT *, (COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as engagement FROM posts WHERE status = 'posted' ORDER BY engagement ASC LIMIT 5"
  ).all();

  // Average engagement
  const avg = await c.env.DB.prepare(
    "SELECT AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as total_posts, SUM(COALESCE(likes,0)) as total_likes, SUM(COALESCE(comments,0)) as total_comments, SUM(COALESCE(shares,0)) as total_shares FROM posts WHERE status = 'posted'"
  ).first<any>();

  return c.json({ top: topPosts, worst: worstPosts, summary: avg });
});

app.get("/api/analytics/best-time", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  // Engagement by hour
  const { results: byHour } = await c.env.DB.prepare(
    "SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as post_count FROM posts WHERE status = 'posted' GROUP BY hour ORDER BY avg_engagement DESC"
  ).all();

  // Engagement by day of week (0=Sunday)
  const { results: byDay } = await c.env.DB.prepare(
    "SELECT CAST(strftime('%w', created_at) AS INTEGER) as day, AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as post_count FROM posts WHERE status = 'posted' GROUP BY day ORDER BY avg_engagement DESC"
  ).all();

  const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const bestHours = (byHour as any[]).slice(0, 3).map((h: any) => h.hour);
  const bestDays = (byDay as any[]).slice(0, 3).map((d: any) => dayNames[d.day]);

  // Build heatmap data (day x hour)
  const { results: heatmap } = await c.env.DB.prepare(
    "SELECT CAST(strftime('%w', created_at) AS INTEGER) as day, CAST(strftime('%H', created_at) AS INTEGER) as hour, AVG(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) as avg_engagement, COUNT(*) as count FROM posts WHERE status = 'posted' GROUP BY day, hour"
  ).all();

  return c.json({
    best_hours: bestHours,
    best_days: bestDays,
    by_hour: byHour,
    by_day: (byDay as any[]).map((d: any) => ({ ...d, day_name: dayNames[d.day] })),
    heatmap,
    recommendation: bestHours.length > 0 && bestDays.length > 0
      ? "ควรโพสวัน" + bestDays[0] + " เวลา " + bestHours[0] + ":00 น."
      : "ยังไม่มีข้อมูลเพียงพอ โพสเพิ่มเพื่อวิเคราะห์",
  });
});

// --- Fetch Post Engagement (update from FB) ---
app.post("/api/analytics/refresh", async (c) => {
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
      const res = await fetch(
        "https://graph.facebook.com/v25.0/" + post.fb_post_id + "?fields=likes.summary(true),comments.summary(true),shares&access_token=" + page.page_token
      );
      const data: any = await res.json();
      if (!data.error) {
        const likes = data.likes?.summary?.total_count || 0;
        const comments = data.comments?.summary?.total_count || 0;
        const shares = data.shares?.count || 0;
        await c.env.DB.prepare(
          "UPDATE posts SET likes = ?, comments = ?, shares = ? WHERE id = ?"
        ).bind(likes, comments, shares, post.id).run();
        updated++;
      }
    } catch {}
  }

  return c.json({ ok: true, updated, total: posts.length });
});

// --- Data Deletion Callback (Facebook requirement) ---

async function parseSignedRequest(signedRequest: string, appSecret: string): Promise<{ user_id: string; algorithm: string; issued_at: number } | null> {
  const [encodedSig, encodedPayload] = signedRequest.split(".");
  if (!encodedSig || !encodedPayload) return null;

  const base64Decode = (s: string) => {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  };

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expectedSig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  const expectedSigB64 = btoa(String.fromCharCode(...new Uint8Array(expectedSig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  if (encodedSig !== expectedSigB64) return null;

  try {
    return JSON.parse(base64Decode(encodedPayload));
  } catch {
    return null;
  }
}

app.post("/auth/deauthorize", async (c) => {
  let signedRequest: string | null = null;
  try {
    const formData = await c.req.formData();
    signedRequest = formData.get("signed_request") as string;
  } catch {
    return c.json({ error: "Missing signed_request" }, 400);
  }
  if (!signedRequest) return c.json({ error: "Missing signed_request" }, 400);

  const appSecret = await c.env.KV.get("fb_app_secret");
  if (!appSecret) return c.json({ error: "App secret not configured" }, 500);

  const payload = await parseSignedRequest(signedRequest, appSecret);
  if (!payload) return c.json({ error: "Invalid signed_request" }, 403);

  const userId = payload.user_id;
  const confirmationCode = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  await c.env.DB.prepare("DELETE FROM posts WHERE fb_user_id = ?").bind(userId).run();
  await c.env.DB.prepare("DELETE FROM users WHERE fb_id = ?").bind(userId).run();

  const storedUserId = await c.env.KV.get("fb_user_id");
  if (storedUserId === userId) {
    await c.env.KV.delete("fb_page_token");
    await c.env.KV.delete("fb_page_id");
    await c.env.KV.delete("fb_page_name");
    await c.env.KV.delete("fb_user_id");
  }

  await c.env.DB.prepare(
    "INSERT INTO deletion_requests (fb_user_id, confirmation_code, status, created_at) VALUES (?, ?, 'completed', ?)"
  ).bind(userId, confirmationCode, new Date().toISOString()).run();

  return c.json({
    url: `https://fb.makeloops.xyz/auth/deletion-status?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
});

app.get("/auth/deletion-status", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.html("<h1>Missing confirmation code</h1>", 400);

  const result = await c.env.DB.prepare(
    "SELECT * FROM deletion_requests WHERE confirmation_code = ?"
  ).bind(code).first();

  if (!result) return c.html("<h1>Invalid confirmation code</h1>", 404);

  return c.html(`<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Data Deletion Status</title>
<style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px;color:#333}
.status{background:#e8f5e9;border:1px solid #4caf50;border-radius:8px;padding:20px;margin:20px 0}
h1{color:#2e7d32}</style></head><body>
<h1>Data Deletion Status</h1>
<div class="status">
<p><strong>Confirmation Code:</strong> ${result.confirmation_code}</p>
<p><strong>Status:</strong> ${result.status === "completed" ? "Completed — All data has been deleted" : "Processing"}</p>
<p><strong>Requested:</strong> ${result.created_at}</p>
</div>
<p>Your data associated with this application has been permanently deleted from our systems.</p>
</body></html>`);
});

// Serve frontend
app.get("/*", serveStatic({ root: "./" }));

// --- Cron: Process Scheduled Posts ---
async function processScheduledPosts(env: Env) {
  const now = new Date().toISOString();
  console.log(`[cron] checking scheduled posts at ${now}`);
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
      let result: any;
      if (post.image_url) {
        const res = await fetch(`https://graph.facebook.com/v25.0/${post.page_id}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: post.image_url, message: post.message, access_token: post.page_token }),
        });
        result = await res.json();
      } else {
        const res = await fetch(`https://graph.facebook.com/v25.0/${post.page_id}/feed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: post.message, access_token: post.page_token }),
        });
        result = await res.json();
      }
      if (result.error) {
        await env.DB.prepare("UPDATE scheduled_posts SET status = 'failed' WHERE id = ?").bind(post.id).run();
      } else {
        const fbPostId = result.id || result.post_id || null;
        await env.DB.prepare("UPDATE scheduled_posts SET status = 'posted', fb_post_id = ? WHERE id = ?").bind(fbPostId, post.id).run();
        await env.DB.prepare(
          "INSERT INTO posts (message, image_url, fb_post_id, status, created_at) VALUES (?, ?, ?, 'posted', ?)"
        ).bind(post.message, post.image_url, fbPostId, new Date().toISOString()).run();
      }
    } catch {
      await env.DB.prepare("UPDATE scheduled_posts SET status = 'failed' WHERE id = ?").bind(post.id).run();
    }
  }
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processScheduledPosts(env));
  },
};
