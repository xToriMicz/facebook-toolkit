import { Hono } from "hono";
import { Env, getSessionFromReq, kvCache } from "../helpers";

const trends = new Hono<{ Bindings: Env }>();

type TrendItem = { title: string; source: string; category: string; traffic?: string; link?: string };

function guessCategory(title: string): string {
  const t = title.toLowerCase().replace(/#/g, "");
  if (/รถ|รถยนต์|toyota|honda|nissan|mazda|isuzu|mitsubishi|suzuki|mg|byd|ora|neta|gwm|motor.?show|ยานยนต์|ev|รถไฟฟ้า|ปิกอัพ|suv|sedan|มอเตอร์ไซค์|bigbike|ฮอนด้า|โตโยต้า|เทสลา|tesla|benz|bmw|audi|porsche|volvo|hyundai|kia|car|automotive|ขับ|test.?drive|เปิดตัว.*รถ|รถใหม่/i.test(t)) return "auto";
  if (/shopee|lazada|tiktok.?shop|โปรโมชั่น|ลดราคา|flash.?sale|คูปอง|ส่วนลด|รีวิว.*สินค้า|affiliate|โค้ด|voucher|11\.11|12\.12|9\.9|mid.?year|big.?sale|mega.?sale|deal|กดสั่ง|สั่งซื้อ|ช้อป|shopping|cart|เก็บโค้ด|ของดี|ของถูก|ราคา.*บาท/i.test(t)) return "shopping";
  if (/สุขภาพ|health|อาหาร|อาหารเสริม|วิตามิน|skincare|ครีม|เซรั่ม|collagen|กันแดด|sunscreen|ลดน้ำหนัก|diet|protein|whey|ออกกำลัง|gym|fitness|yoga|คาเฟ่|cafe|ร้านอาหาร|restaurant|มิชลิน|michelin|บุฟเฟ่ต์|buffet|ชาไข่มุก|boba|starbucks|beauty|เครื่องสำอาง|makeup|cosmetic|เวชสำอาง|ดูแลผิว/i.test(t)) return "health";
  if (/บอล|ฟุตบอล|กีฬา|แข่ง|โอลิมปิก|มวย|tennis|football|sport|league|nba|fifa|f1|boxing|premier league|world cup|ลาลีกา|arsenal|liverpool|chelsea|man city|ucl|europa/i.test(t)) return "sports";
  if (/ดารา|หนัง|เพลง|ซีรี|ละคร|concert|anime|netflix|movie|kpop|idol|นักแสดง|ศิลปิน|ภาพยนตร์|รางวัล|grammy|บันเทิง|ไวรัล|tiktok|youtube|mv|romance|scammer|melody|music.?awards|fan.?meet|debut|comeback|ep\d/i.test(t)) return "entertainment";
  if (/การเมือง|เลือกตั้ง|นายก|รัฐบาล|สภา|กฎหมาย|ศาล|politics|พรรค|ครม\.|ข่าว|อุบัติเหตุ|น้ำท่วม|แผ่นดินไหว|ภัยพิบัติ/i.test(t)) return "news";
  if (/หุ้น|ทอง|bitcoin|crypto|เศรษฐกิจ|stock|economy|set|ตลาดหลักทรัพย์|ลงทุน|ค่าเงิน|eth|solana|defi/i.test(t)) return "finance";
  if (/ai|เทคโนโลยี|tech|iphone|android|samsung|apple|google|microsoft|app|gadget|5g|spacex|chatgpt|gemini|claude|startup/i.test(t)) return "tech";
  return "general";
}

// GET /api/trends — parallel: Google Trends + X/Twitter Thailand
trends.get("/trends", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const categoryFilter = c.req.query("category");

  try {
    const data = await kvCache(c.env.KV, "trends:th:v5", 900, async () => {
      // Parallel fetch both sources
      const [googleItems, xItems, newsItems] = await Promise.all([
        fetchGoogleTrends(),
        fetchXTwitterTrends(),
        fetchAffiliateNews(),
      ]);

      const all = [...googleItems, ...xItems, ...newsItems];
      return { trends: all, updated_at: new Date().toISOString() };
    });

    // Apply category filter if requested
    let filtered = data.trends;
    if (categoryFilter && categoryFilter !== "all") {
      filtered = filtered.filter((t: TrendItem) => t.category === categoryFilter);
    }

    return c.json({ trends: filtered, total: filtered.length, updated_at: data.updated_at });
  } catch {
    return c.json({ trends: [], total: 0, updated_at: null });
  }
});

async function fetchGoogleTrends(): Promise<TrendItem[]> {
  const items: TrendItem[] = [];
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
      const traffic = getTag("ht:approx_traffic");
      const link = getTag("link");
      if (title) items.push({ title, source: "Google Trends", category: guessCategory(title), traffic, link });
    }
  } catch {}
  return items;
}

async function fetchXTwitterTrends(): Promise<TrendItem[]> {
  const items: TrendItem[] = [];
  try {
    const res = await fetch("https://getdaytrends.com/thailand/", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FBToolkit/1.0)" },
    });
    if (!res.ok) return items;
    const html = await res.text();
    const tagRegex = /<a[^>]*href="\/thailand\/trend\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
    const seen = new Set<string>();
    let m;
    while ((m = tagRegex.exec(html)) !== null && items.length < 10) {
      const title = m[1].trim();
      const key = title.toLowerCase();
      if (title && !seen.has(key)) { seen.add(key); items.push({ title, source: "X/Twitter", category: guessCategory(title) }); }
    }
  } catch {}
  return items;
}

async function fetchAffiliateNews(): Promise<TrendItem[]> {
  const feeds: { q: string; cat: string }[] = [
    { q: "รถยนต์ เปิดตัว รีวิว", cat: "auto" },
    { q: "รีวิว สินค้า โปรโมชั่น ลดราคา", cat: "shopping" },
    { q: "สุขภาพ อาหาร คาเฟ่ skincare", cat: "health" },
  ];
  const items: TrendItem[] = [];
  try {
    const results = await Promise.all(feeds.map(async (f) => {
      const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(f.q) + "&hl=th&gl=TH&ceid=TH:th";
      const res = await fetch(url);
      const xml = await res.text();
      const out: TrendItem[] = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let match;
      while ((match = itemRegex.exec(xml)) !== null && out.length < 3) {
        const block = match[1];
        const tm = block.match(/<title>([\s\S]*?)<\/title>/);
        const lm = block.match(/<link>([\s\S]*?)<\/link>/);
        const title = tm ? tm[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
        const link = lm ? lm[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
        if (title) out.push({ title, source: "News", category: f.cat, link });
      }
      return out;
    }));
    results.forEach(r => items.push(...r));
  } catch {}
  return items;
}

export default trends;
