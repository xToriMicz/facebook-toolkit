import { Hono } from "hono";
import { Env, getSessionFromReq, kvCache } from "../helpers";

const trends = new Hono<{ Bindings: Env }>();

// GET /api/trends — trending topics from Google Trends Thailand
trends.get("/trends", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  try {
    const data = await kvCache(c.env.KV, "trends:th", 900, async () => {
      const items: { title: string; source: string; traffic?: string; link?: string }[] = [];

      // Google Trends Daily (Thailand) — public RSS
      try {
        const res = await fetch("https://trends.google.co.th/trending/rss?geo=TH");
        const xml = await res.text();
        const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
        let match;
        while ((match = itemRegex.exec(xml)) !== null && items.length < 15) {
          const block = match[1];
          const getTag = (tag: string) => {
            const m = block.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">"));
            return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
          };
          const title = getTag("title");
          const traffic = getTag("ht:approx_traffic") || getTag("ht:picture_count");
          const link = getTag("link");
          if (title) items.push({ title, source: "Google Trends", traffic, link });
        }
      } catch {}

      // Fallback: if Google Trends empty, try Twitter/X trending (via Nitter or public proxy)
      if (items.length === 0) {
        try {
          const res = await fetch("https://trends24.in/thailand/");
          const html = await res.text();
          const tagRegex = /<a[^>]*class="trend-link"[^>]*>([^<]+)<\/a>/gi;
          let m;
          while ((m = tagRegex.exec(html)) !== null && items.length < 15) {
            items.push({ title: m[1].trim(), source: "X/Twitter" });
          }
        } catch {}
      }

      return { trends: items, updated_at: new Date().toISOString() };
    });

    return c.json(data);
  } catch {
    return c.json({ trends: [], updated_at: null });
  }
});

export default trends;
