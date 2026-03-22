import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/cloudflare-workers";

interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", cors());

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

// Serve frontend
app.get("/*", serveStatic({ root: "./" }));

export default app;
