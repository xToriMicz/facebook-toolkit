import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/cloudflare-workers";
import auth from "./auth";

interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  KV: KVNamespace;
  FB_APP_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", cors({
  origin: "https://fb.makeloops.xyz",
  credentials: true,
}));

// Auth routes: /auth/facebook, /auth/callback, /auth/logout, /api/me
app.route("/auth", auth);
app.route("/", auth); // for /api/me

// Health check
app.get("/api/health", (c) => c.json({ ok: true, service: "facebook-toolkit" }));

// --- Facebook Page Post ---
app.post("/api/post", async (c) => {
  const { message, image_url } = await c.req.json();
  const token = await c.env.KV.get("fb_page_token");
  const pageId = await c.env.KV.get("fb_page_id");

  if (!token || !pageId) {
    return c.json({ error: "Facebook token not configured. Set via /api/settings" }, 400);
  }

  try {
    let result;
    if (image_url) {
      // Post photo with message
      const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: image_url, message, access_token: token }),
      });
      result = await res.json();
    } else {
      // Text-only post
      const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, access_token: token }),
      });
      result = await res.json();
    }

    // Save to history
    await c.env.DB.prepare(
      "INSERT INTO posts (message, image_url, fb_post_id, created_at) VALUES (?, ?, ?, ?)"
    ).bind(message, image_url || null, (result as any).id || (result as any).post_id || null, new Date().toISOString()).run();

    return c.json({ ok: true, result });
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

// --- Post history ---
app.get("/api/posts", async (c) => {
  const limit = Math.min(50, +(c.req.query("limit") || "20"));
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM posts ORDER BY created_at DESC LIMIT ?"
  ).bind(limit).all();
  return c.json({ posts: results });
});

// --- Settings (token management) ---
app.get("/api/settings", async (c) => {
  const pageId = await c.env.KV.get("fb_page_id");
  const hasToken = !!(await c.env.KV.get("fb_page_token"));
  const pageName = await c.env.KV.get("fb_page_name");
  return c.json({ page_id: pageId, page_name: pageName, has_token: hasToken });
});

app.post("/api/settings", async (c) => {
  const { page_id, page_token, page_name } = await c.req.json();
  if (page_id) await c.env.KV.put("fb_page_id", page_id);
  if (page_token) await c.env.KV.put("fb_page_token", page_token);
  if (page_name) await c.env.KV.put("fb_page_name", page_name);
  return c.json({ ok: true });
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

export default app;
