import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/cloudflare-workers";
import auth from "./auth";
import { Env } from "./helpers";
import post from "./routes/post";
import schedule, { processScheduledPosts } from "./routes/schedule";
import drafts from "./routes/drafts";
import ai from "./routes/ai";
import analytics, { refreshAllEngagement } from "./routes/analytics";
import media from "./routes/media";
import rss from "./routes/rss";
import tickets from "./routes/tickets";
import trends from "./routes/trends";
import shopee from "./routes/shopee-trends";

const app = new Hono<{ Bindings: Env }>();

// --- Middleware ---

// Security + cache headers
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("X-XSS-Protection", "1; mode=block");
  if (!c.req.path.startsWith("/api/")) {
    c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://graph.facebook.com https://down-th.img.susercontent.com https://*.fbcdn.net https://platform-lookaside.fbsbx.com https://image.pollinations.ai data:; connect-src 'self' https://graph.facebook.com https://www.facebook.com https://cloudflareinsights.com; frame-ancestors 'none';");
  }
  const path = c.req.path;
  if (path.startsWith("/api/")) {
    c.header("Cache-Control", "private, max-age=0");
  } else if (path.startsWith("/img/")) {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  }
});

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

// --- Auth ---
app.route("/auth", auth);
app.route("/", auth); // for /api/me, /api/pages

// --- Routes ---
app.get("/api/health", (c) => c.json({ ok: true, service: "facebook-toolkit" }));

// Favicon
app.get("/favicon.ico", (c) => {
  return new Response(null, { status: 204, headers: { "Cache-Control": "public, max-age=86400" } });
});

// Mount route modules under /api
app.route("/api", post);
app.route("/api", schedule);
app.route("/api", drafts);
app.route("/api", ai);
app.route("/api", analytics);
app.route("/api", media);
app.route("/api", rss);
app.route("/api", tickets);
app.route("/api", trends);
app.route("/api", shopee);

// Alias routes (frontend uses different paths)
app.post("/api/post/schedule", async (c) => {
  // Forward to schedule handler
  const url = new URL(c.req.url);
  url.pathname = "/api/schedule";
  return app.fetch(new Request(url.toString(), c.req.raw), c.env);
});

app.get("/api/posts/scheduled", async (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/api/schedule";
  return app.fetch(new Request(url.toString(), c.req.raw), c.env);
});

// Serve R2 images
app.get("/img/*", async (c) => {
  const key = c.req.path.replace("/img/", "");
  const obj = await c.env.ASSETS.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  headers.set("Content-Type", obj.httpMetadata?.contentType || "image/jpeg");
  headers.set("Cache-Control", "public, max-age=31536000");
  return new Response(obj.body, { headers });
});

// --- Webhook ---
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
            ).bind(entry.id, `${change.value.from?.name || "Someone"}: ${(change.value.message || "").substring(0, 200)}`, change.value.post_id || null).run();
          }
        }
      }
    }
  } catch {}
  return c.text("EVENT_RECEIVED", 200);
});

// --- Data Deletion (Facebook requirement) ---
async function parseSignedRequest(signedRequest: string, appSecret: string): Promise<{ user_id: string } | null> {
  const [encodedSig, encodedPayload] = signedRequest.split(".");
  if (!encodedSig || !encodedPayload) return null;
  const base64Decode = (s: string) => {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  };
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expectedSig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  const expectedSigB64 = btoa(String.fromCharCode(...new Uint8Array(expectedSig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (encodedSig !== expectedSigB64) return null;
  try { return JSON.parse(base64Decode(encodedPayload)); } catch { return null; }
}

app.post("/auth/deauthorize", async (c) => {
  let signedRequest: string | null = null;
  try { const formData = await c.req.formData(); signedRequest = formData.get("signed_request") as string; }
  catch { return c.json({ error: "Missing signed_request" }, 400); }
  if (!signedRequest) return c.json({ error: "Missing signed_request" }, 400);
  const appSecret = await c.env.KV.get("fb_app_secret");
  if (!appSecret) return c.json({ error: "App secret not configured" }, 500);
  const payload = await parseSignedRequest(signedRequest, appSecret);
  if (!payload) return c.json({ error: "Invalid signed_request" }, 403);
  const userId = payload.user_id;
  const confirmationCode = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const storedUserId = await c.env.KV.get("fb_user_id");
  if (storedUserId === userId) {
    await c.env.KV.delete("fb_page_token"); await c.env.KV.delete("fb_page_id");
    await c.env.KV.delete("fb_page_name"); await c.env.KV.delete("fb_user_id");
  }
  await c.env.DB.prepare(
    "INSERT INTO deletion_requests (fb_user_id, confirmation_code, status, created_at) VALUES (?, ?, 'completed', ?)"
  ).bind(userId, confirmationCode, new Date().toISOString()).run();
  return c.json({ url: `https://fb.makeloops.xyz/auth/deletion-status?code=${confirmationCode}`, confirmation_code: confirmationCode });
});

app.get("/auth/deletion-status", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.html("<h1>Missing confirmation code</h1>", 400);
  const result = await c.env.DB.prepare("SELECT * FROM deletion_requests WHERE confirmation_code = ?").bind(code).first();
  if (!result) return c.html("<h1>Invalid confirmation code</h1>", 404);
  return c.html(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Data Deletion Status</title><style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px;color:#333}.status{background:#e8f5e9;border:1px solid #4caf50;border-radius:8px;padding:20px;margin:20px 0}h1{color:#2e7d32}</style></head><body><h1>Data Deletion Status</h1><div class="status"><p><strong>Confirmation Code:</strong> ${result.confirmation_code}</p><p><strong>Status:</strong> ${result.status === "completed" ? "Completed" : "Processing"}</p><p><strong>Requested:</strong> ${result.created_at}</p></div><p>Your data has been permanently deleted.</p></body></html>`);
});

// --- Static ---
app.get("/*", serveStatic({ root: "./" }));

// --- Export ---
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processScheduledPosts(env));
    // Refresh engagement every ~30 min (check KV throttle)
    const lastRefresh = await env.KV.get("cron:engagement:last");
    const now = Date.now();
    if (!lastRefresh || now - parseInt(lastRefresh) > 1800000) {
      ctx.waitUntil(
        refreshAllEngagement(env).then(() => env.KV.put("cron:engagement:last", String(now), { expirationTtl: 3600 }))
      );
    }
  },
};
