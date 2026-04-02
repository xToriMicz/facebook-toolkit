import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { setUserPage, getUserPageId, encryptToken, type Env } from "./helpers";

/** Download image from URL and upload to R2, return public URL */
async function cacheImageToR2(assets: R2Bucket, imageUrl: string, key: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, { redirect: "follow" });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const data = await res.arrayBuffer();
    await assets.put(key, data, { httpMetadata: { contentType } });
    return `https://fb.makeloops.xyz/img/${key}`;
  } catch { return null; }
}

const FB_APP_ID = "26012743801749271";
const FB_REDIRECT_URI = "https://fb.makeloops.xyz/auth/callback";
const FB_GRAPH_VERSION = "v25.0";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

const auth = new Hono<{ Bindings: Env }>();

// GET /auth/facebook — redirect to Facebook OAuth dialog (rate limited)
auth.get("/facebook", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const hour = new Date().toISOString().slice(0, 16); // per minute
  const k = `rl:auth:${ip}:${hour}`;
  const count = parseInt(await c.env.KV.get(k) || "0");
  if (count >= 10) return c.text("Too many login attempts. Try again later.", 429);
  await c.env.KV.put(k, String(count + 1), { expirationTtl: 60 });

  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: FB_APP_ID,
    redirect_uri: FB_REDIRECT_URI,
    state,
    response_type: "code",
    scope: "public_profile,pages_manage_posts,pages_read_engagement,pages_show_list",
  });

  // Store state in cookie (not KV — avoids eventual consistency issues)
  setCookie(c, "oauth_state", state, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 300,
  });

  return c.redirect(`https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth?${params}`);
});

// GET /auth/callback — exchange code for token, save user
auth.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  // User denied
  if (error) {
    return c.redirect("/?error=access_denied");
  }

  if (!code || !state) {
    return c.redirect("/?error=missing_params");
  }

  // Verify CSRF state from cookie
  const storedState = getCookie(c, "oauth_state");
  deleteCookie(c, "oauth_state", { path: "/" });
  if (!storedState || storedState !== state) {
    return c.redirect("/?error=invalid_state");
  }

  // Exchange code for access token
  const tokenUrl = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", FB_APP_ID);
  tokenUrl.searchParams.set("redirect_uri", FB_REDIRECT_URI);
  tokenUrl.searchParams.set("client_secret", c.env.FB_APP_SECRET);
  tokenUrl.searchParams.set("code", code);

  const tokenRes = await fetch(tokenUrl.toString());
  const tokenData = (await tokenRes.json()) as any;

  if (tokenData.error) {
    return c.redirect(`/?error=token_exchange&detail=${encodeURIComponent(tokenData.error.message)}`);
  }

  const shortToken = tokenData.access_token;

  // Exchange short-lived for long-lived user token
  const longUrl = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", FB_APP_ID);
  longUrl.searchParams.set("client_secret", c.env.FB_APP_SECRET);
  longUrl.searchParams.set("fb_exchange_token", shortToken);

  const longRes = await fetch(longUrl.toString());
  const longData = (await longRes.json()) as any;
  const longToken = longData.access_token || shortToken;

  // Get user profile
  const profileRes = await fetch(
    `https://graph.facebook.com/${FB_GRAPH_VERSION}/me?fields=id,name,email,picture&access_token=${longToken}`
  );
  const profile = (await profileRes.json()) as any;

  if (!profile.id) {
    return c.redirect("/?error=profile_fetch");
  }

  // Get user's pages (with picture)
  const pagesRes = await fetch(
    `https://graph.facebook.com/${FB_GRAPH_VERSION}/${profile.id}/accounts?fields=id,name,access_token,category,picture&access_token=${longToken}`
  );
  const pagesData = (await pagesRes.json()) as any;
  console.log("[auth] user:", profile.id, profile.name, "pages_count:", (pagesData.data || []).length, "error:", pagesData.error?.message || "none");
  const pages = (pagesData.data || []).map((p: any) => ({
    ...p,
    picture_url: p.picture?.data?.url || `https://graph.facebook.com/${p.id}/picture?type=small`,
  }));

  // Cache profile + page pictures to R2
  for (const page of pages) {
    if (page.picture_url) {
      const cached = await cacheImageToR2(c.env.ASSETS, page.picture_url, `avatars/page-${page.id}.jpg`);
      if (cached) page.picture_url = cached;
    }
  }

  // Save user to D1
  try {
    const userPicSrc = profile.picture?.data?.url || null;
    const pictureUrl = userPicSrc
      ? (await cacheImageToR2(c.env.ASSETS, userPicSrc, `avatars/user-${profile.id}.jpg`)) || userPicSrc
      : null;
    const now = new Date().toISOString();
    const firstPage = pages.length > 0 ? pages[0] : null;
    const encKey = c.env.TOKEN_ENCRYPTION_KEY || c.env.FB_APP_SECRET;

    // Encrypt tokens before storing
    const encryptedUserToken = await encryptToken(longToken, encKey);
    const encryptedFirstPageToken = firstPage?.access_token
      ? await encryptToken(firstPage.access_token, encKey) : null;

    await c.env.DB.prepare(
      `INSERT INTO users (fb_user_id, name, email, profile_pic, access_token, page_id, page_name, page_token, created_at, last_login)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fb_user_id) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         profile_pic = excluded.profile_pic,
         access_token = excluded.access_token,
         page_id = excluded.page_id,
         page_name = excluded.page_name,
         page_token = excluded.page_token,
         last_login = excluded.last_login`
    ).bind(
      profile.id,
      profile.name || "",
      profile.email || null,
      pictureUrl,
      encryptedUserToken,
      firstPage?.id || null,
      firstPage?.name || null,
      encryptedFirstPageToken,
      now,
      now
    ).run();

    // Save ALL pages to user_pages table (with picture) — encrypted tokens
    for (const page of pages) {
      const encPageToken = await encryptToken(page.access_token, encKey);
      await c.env.DB.prepare(
        `INSERT INTO user_pages (user_fb_id, page_id, page_name, page_token, category, picture_url)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_fb_id, page_id) DO UPDATE SET
           page_name = excluded.page_name,
           page_token = excluded.page_token,
           category = excluded.category,
           picture_url = excluded.picture_url`
      ).bind(
        profile.id,
        page.id,
        page.name,
        encPageToken,
        page.category || null,
        page.picture_url || null
      ).run();
    }

    // Store first page in KV as default (per-user) — encrypted
    if (pages.length > 0) {
      await setUserPage(c.env.KV, profile.id, pages[0].id, pages[0].access_token, pages[0].name, encKey);
    }
  } catch (e: any) {
    console.error("DB save error:", e.message);
    return c.redirect(`/?error=db_error&detail=${encodeURIComponent(e.message)}`);
  }

  // Create session
  const sessionId = crypto.randomUUID();
  await c.env.KV.put(`session:${sessionId}`, JSON.stringify({
    fb_id: profile.id,
    name: profile.name || "",
    email: profile.email || "",
    picture: pictureUrl || "",
    pages: pages.map((p: any) => ({ id: p.id, name: p.name, category: p.category || null, picture: p.picture_url || null })),
  }), { expirationTtl: SESSION_TTL });

  // Build redirect response with Set-Cookie header explicitly
  // (setCookie + c.redirect can lose headers in some Hono versions)
  const cookieValue = `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/?login=success",
      "Set-Cookie": cookieValue,
    },
  });
});

// GET + POST /auth/logout — clear session
const logoutHandler = async (c: any) => {
  const sessionId = getCookie(c, "session");
  if (sessionId) {
    await c.env.KV.delete(`session:${sessionId}`);
  }
  deleteCookie(c, "session", { path: "/" });
  return c.redirect("/");
};
auth.get("/logout", logoutHandler);
auth.post("/logout", logoutHandler);

// GET /api/me — return current user info
auth.get("/api/me", async (c) => {
  const sessionId = getCookie(c, "session");
  if (!sessionId) {
    return c.json({ logged_in: false }, 401);
  }

  const sessionData = await c.env.KV.get(`session:${sessionId}`);
  if (!sessionData) {
    deleteCookie(c, "session", { path: "/" });
    return c.json({ logged_in: false }, 401);
  }

  return c.json({ logged_in: true, user: JSON.parse(sessionData) });
});

// GET /api/pages — return all pages for current user
auth.get("/api/pages", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { results } = await c.env.DB.prepare(
    "SELECT page_id, page_name, category, picture_url FROM user_pages WHERE user_fb_id = ?"
  ).bind(session.fb_id).all();

  const selectedPageId = await getUserPageId(c.env.KV, session.fb_id);

  return c.json({
    pages: results.map((p: any) => ({
      id: p.page_id,
      name: p.page_name,
      category: p.category,
      picture: p.picture_url || `https://graph.facebook.com/${p.page_id}/picture?type=small`,
      selected: p.page_id === selectedPageId,
    })),
  });
});

// POST /api/pages/select — select active page for posting
auth.post("/api/pages/select", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { page_id } = await c.req.json() as { page_id: string };
  if (!page_id) return c.json({ error: "page_id required" }, 400);

  const page = await c.env.DB.prepare(
    "SELECT * FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, page_id).first() as any;

  if (!page) return c.json({ error: "Page not found" }, 404);

  // page.page_token is already encrypted in DB — pass through to KV as-is
  await setUserPage(c.env.KV, session.fb_id, page.page_id, page.page_token, page.page_name);

  return c.json({ ok: true, selected: { id: page.page_id, name: page.page_name } });
});

// Helper: get session from request (for use in other routes)
export async function getSession(c: any): Promise<any | null> {
  const sessionId = getCookie(c, "session");
  if (!sessionId) return null;
  const data = await c.env.KV.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

export default auth;
