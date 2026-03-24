import { Hono } from "hono";
import { Env, getSessionFromReq, getUserPageId, getUserPageToken, setUserPage } from "../helpers";

const media = new Hono<{ Bindings: Env }>();

// POST /api/reels
media.post("/reels", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { video_url, description, page_id } = await c.req.json();
  if (!video_url) return c.json({ error: "video_url required" }, 400);
  const targetPageId = page_id || await getUserPageId(c.env.KV, session.fb_id);
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
      method: "POST", headers: { "Authorization": `OAuth ${page.page_token}`, "file_url": video_url },
    });
    const uploadData: any = await uploadRes.json();
    if (!uploadData.success) return c.json({ error: "Upload failed", step: "upload" }, 400);
    const pubRes = await fetch(`https://graph.facebook.com/v25.0/${targetPageId}/video_reels`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId, upload_phase: "finish", video_state: "PUBLISHED", description: description || "", access_token: page.page_token }),
    });
    const pubData: any = await pubRes.json();
    if (pubData.error) return c.json({ error: pubData.error.message, step: "publish" }, 400);
    await c.env.DB.prepare(
      "INSERT INTO posts (message, fb_post_id, status, created_at) VALUES (?, ?, 'posted', ?)"
    ).bind("[Reel] " + (description || ""), pubData.id || videoId, new Date().toISOString()).run();
    return c.json({ ok: true, video_id: videoId, result: pubData });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// POST /api/stories
media.post("/stories", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { image_url, video_url, page_id } = await c.req.json();
  if (!image_url && !video_url) return c.json({ error: "image_url or video_url required" }, 400);
  const targetPageId = page_id || await getUserPageId(c.env.KV, session.fb_id);
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

// GET/POST /api/settings
media.get("/settings", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const [pageId, pageToken, pageName, apifyKey, geminiKey, falKey, imageProvider] = await Promise.all([
    getUserPageId(c.env.KV, session.fb_id), getUserPageToken(c.env.KV, session.fb_id), c.env.KV.get(`u:${session.fb_id}:page_name`),
    c.env.KV.get(`u:${session.fb_id}:apify_key`), c.env.KV.get(`u:${session.fb_id}:gemini_key`), c.env.KV.get(`u:${session.fb_id}:fal_key`),
    c.env.KV.get(`u:${session.fb_id}:image_provider`),
  ]);
  return c.json({ page_id: pageId, page_name: pageName, has_token: !!pageToken, has_apify_key: !!apifyKey, has_gemini_key: !!geminiKey, has_fal_key: !!falKey, image_provider: imageProvider || "pollinations" });
});

media.post("/settings", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { page_id, page_token, page_name, apify_api_key, gemini_api_key, fal_api_key, image_provider } = await c.req.json();
  if (page_id && page_token) await setUserPage(c.env.KV, session.fb_id, page_id, page_token, page_name || "");
  // Shopee/Apify key (per-user)
  const uk = (k: string) => `u:${session.fb_id}:${k}`;
  if (apify_api_key !== undefined) {
    if (apify_api_key) await c.env.KV.put(uk("apify_key"), apify_api_key);
    else await c.env.KV.delete(uk("apify_key"));
    await c.env.KV.delete("shopee:trending:v2");
  }
  // Gemini / Nano Banana Pro key (per-user)
  if (gemini_api_key !== undefined) {
    if (gemini_api_key) await c.env.KV.put(uk("gemini_key"), gemini_api_key);
    else await c.env.KV.delete(uk("gemini_key"));
  }
  // FAL.ai key (per-user)
  if (fal_api_key !== undefined) {
    if (fal_api_key) await c.env.KV.put(uk("fal_key"), fal_api_key);
    else await c.env.KV.delete(uk("fal_key"));
  }
  // Image provider preference (per-user)
  if (image_provider && ["pollinations", "fal", "unsplash"].includes(image_provider)) {
    await c.env.KV.put(uk("image_provider"), image_provider);
  }
  return c.json({ ok: true });
});

export default media;
