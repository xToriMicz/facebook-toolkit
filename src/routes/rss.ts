import { Hono } from "hono";
import { Env, getSessionFromReq } from "../helpers";

const rss = new Hono<{ Bindings: Env }>();

rss.post("/rss-feeds", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { url, title } = await c.req.json();
  if (!url) return c.json({ error: "url required" }, 400);
  const { meta } = await c.env.DB.prepare(
    "INSERT INTO rss_feeds (user_fb_id, url, title) VALUES (?, ?, ?)"
  ).bind(session.fb_id, url, title || null).run();
  return c.json({ ok: true, id: meta.last_row_id }, 201);
});

rss.get("/rss-feeds", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM rss_feeds WHERE user_fb_id = ? ORDER BY created_at DESC"
  ).bind(session.fb_id).all();
  return c.json({ feeds: results, total: results.length });
});

rss.delete("/rss-feeds/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  await c.env.DB.prepare("DELETE FROM rss_feeds WHERE id = ? AND user_fb_id = ?").bind(c.req.param("id"), session.fb_id).run();
  return c.json({ ok: true });
});

rss.post("/rss-feeds/:id/fetch", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  const feed = await c.env.DB.prepare(
    "SELECT * FROM rss_feeds WHERE id = ? AND user_fb_id = ?"
  ).bind(id, session.fb_id).first<any>();
  if (!feed) return c.json({ error: "Feed not found" }, 404);

  try {
    const res = await fetch(feed.url);
    const xml = await res.text();
    const items: any[] = [];
    const itemRegex = /<item[\s\S]*?<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
      const item = match[0];
      const getTag = (tag: string) => {
        const m = item.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">"));
        return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
      };
      items.push({ title: getTag("title"), link: getTag("link"), description: getTag("description").slice(0, 200), pubDate: getTag("pubDate") });
    }

    await c.env.DB.prepare("UPDATE rss_feeds SET last_fetched_at = datetime('now') WHERE id = ?").bind(id).run();

    if (feed.auto_draft && items.length > 0) {
      const newest = items[0];
      if (newest.title !== feed.last_item_id) {
        const msg = newest.title + "\n\n" + newest.description + "\n\nอ่านเพิ่มเติม: " + newest.link;
        await c.env.DB.prepare(
          "INSERT INTO drafts (user_fb_id, message, image_url) VALUES (?, ?, NULL)"
        ).bind(session.fb_id, msg).run();
        await c.env.DB.prepare("UPDATE rss_feeds SET last_item_id = ? WHERE id = ?").bind(newest.title, id).run();
      }
    }

    return c.json({ ok: true, items, feed_title: feed.title });
  } catch (e: any) {
    return c.json({ error: "Fetch failed: " + e.message }, 500);
  }
});

export default rss;
