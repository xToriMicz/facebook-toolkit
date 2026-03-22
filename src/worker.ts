import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/cloudflare-workers";
import auth, { getSession } from "./auth";
import { getCookie } from "hono/cookie";

interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  KV: KVNamespace;
  FB_APP_SECRET: string;
  ANTHROPIC_API_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();
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

// Health check
app.get("/api/health", (c) => c.json({ ok: true, service: "facebook-toolkit" }));

// --- Facebook Page Post (reads token from user_pages via session) ---
app.post("/api/post", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { message, image_url, page_id } = await c.req.json();
  if (!message && !image_url) return c.json({ error: "message or image_url required" }, 400);

  // Use selected page or provided page_id
  const targetPageId = page_id || await c.env.KV.get("fb_page_id");
  if (!targetPageId) return c.json({ error: "No page selected" }, 400);

  // Get page token from user_pages table
  const page = await c.env.DB.prepare(
    "SELECT page_token, page_name FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, targetPageId).first<{ page_token: string; page_name: string }>();

  if (!page?.page_token) {
    return c.json({ error: "Page not found or token missing. Connect page first." }, 400);
  }

  try {
    let result: any;
    if (image_url) {
      const res = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: image_url, message: message || "", access_token: page.page_token }),
      });
      result = await res.json();
    } else {
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

    await c.env.DB.prepare(
      "INSERT INTO posts (message, image_url, fb_post_id, status, created_at) VALUES (?, ?, ?, 'posted', ?)"
    ).bind(message || "", image_url || null, result.id || result.post_id || null, new Date().toISOString()).run();

    return c.json({ ok: true, result, page_name: page.page_name });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Upload image to R2 ---
app.post("/api/upload", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  if (!file) return c.json({ error: "No file" }, 400);

  const key = `uploads/${Date.now()}-${file.name}`;
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

// --- Post history (filter by user + page) ---
app.get("/api/posts", async (c) => {
  const limit = Math.min(50, +(c.req.query("limit") || "20"));
  const userId = c.req.query("user_fb_id");
  const pageId = c.req.query("page_id");

  let query = "SELECT * FROM posts";
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (userId) { conditions.push("user_fb_id = ?"); params.push(userId); }
  if (pageId) { conditions.push("page_id = ?"); params.push(pageId); }
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
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

// --- AI Content Writer ---
app.post("/api/ai-write", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { topic, tone, format } = await c.req.json() as { topic?: string; tone?: string; format?: string };
  if (!topic) return c.json({ error: "topic required" }, 400);

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

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": c.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: `เขียน caption Facebook เกี่ยวกับ: ${topic}` }],
        system: systemPrompt,
      }),
    });

    const data = await res.json() as any;
    if (data.error) {
      return c.json({ error: data.error.message }, 500);
    }

    const responseText = data.content?.[0]?.text || "";

    // Parse JSON from response
    try {
      const parsed = JSON.parse(responseText);
      return c.json({ ok: true, text: parsed.text, hashtags: parsed.hashtags || [] });
    } catch {
      // If not valid JSON, return raw text
      return c.json({ ok: true, text: responseText, hashtags: [] });
    }
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Content Templates ---
app.get("/api/templates", async (c) => {
  const category = c.req.query("category");
  let query = "SELECT * FROM content_templates";
  const params: string[] = [];
  if (category && category !== "all") {
    query += " WHERE category = ?";
    params.push(category);
  }
  query += " ORDER BY created_at DESC";
  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ templates: results, total: results.length });
});

app.post("/api/templates", async (c) => {
  const { title, template_text, category } = await c.req.json();
  if (!title || !template_text) return c.json({ error: "title and template_text required" }, 400);
  const cat = category || "ทั่วไป";
  const { meta } = await c.env.DB.prepare(
    "INSERT INTO content_templates (title, template_text, category) VALUES (?, ?, ?)"
  ).bind(title, template_text, cat).run();
  return c.json({ ok: true, id: meta.last_row_id }, 201);
});

app.delete("/api/templates/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM content_templates WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// --- Scheduled Posts ---
app.post("/api/schedule", async (c) => {
  const { user_fb_id, page_id, message, image_url, scheduled_at } = await c.req.json();
  if (!user_fb_id || !page_id || !message || !scheduled_at) {
    return c.json({ error: "user_fb_id, page_id, message, scheduled_at required" }, 400);
  }

  // Verify page belongs to user
  const page = await c.env.DB.prepare(
    "SELECT page_id FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(user_fb_id, page_id).first();
  if (!page) return c.json({ error: "Page not found for this user" }, 400);

  const { meta } = await c.env.DB.prepare(
    "INSERT INTO scheduled_posts (user_fb_id, page_id, message, image_url, scheduled_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(user_fb_id, page_id, message, image_url || null, scheduled_at).run();

  return c.json({ ok: true, id: meta.last_row_id }, 201);
});

app.get("/api/schedule", async (c) => {
  const userId = c.req.query("user_fb_id");
  const pageId = c.req.query("page_id");
  const status = c.req.query("status") || "pending";

  let query = "SELECT * FROM scheduled_posts WHERE status = ?";
  const params: string[] = [status];

  if (userId) { query += " AND user_fb_id = ?"; params.push(userId); }
  if (pageId) { query += " AND page_id = ?"; params.push(pageId); }
  query += " ORDER BY scheduled_at ASC";

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ scheduled: results, total: results.length });
});

app.delete("/api/schedule/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(
    "DELETE FROM scheduled_posts WHERE id = ? AND status = 'pending'"
  ).bind(id).run();
  return c.json({ ok: true });
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
  const { results: pending } = await env.DB.prepare(
    "SELECT sp.*, up.page_token FROM scheduled_posts sp JOIN user_pages up ON sp.user_fb_id = up.user_fb_id AND sp.page_id = up.page_id WHERE sp.status = 'pending' AND sp.scheduled_at <= ? LIMIT 10"
  ).bind(now).all();

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
