import { Hono } from "hono";
import { Env, getSessionFromReq, kvCache } from "../helpers";

const trends = new Hono<{ Bindings: Env }>();

type TrendItem = { title: string; source: string; category: string; traffic?: string; link?: string };

function guessCategory(title: string): string {
  const t = title.toLowerCase().replace(/#/g, "");
  if (/บอล|ฟุตบอล|กีฬา|แข่ง|โอลิมปิก|มวย|มวยไทย|แบดมินตัน|วอลเลย์|ตะกร้อ|ว่ายน้ำ|วิ่ง|กอล์ฟ|tennis|football|sport|league|nba|fifa|f1|boxing|volleyball|badminton|premier league|world cup|ซีเกมส์|เอเชียนเกมส์|ลาลีกา|บุนเดส|แชมเปียนส์|โมนาโก|อาร์เซนอล|แมนซิตี|แมนยู|ลิเวอร์พูล|เชลซี|สเปอร์ส|spurs|arsenal|monaco|man city|manchester|liverpool|chelsea|tottenham|la liga|serie a|ไทยลีก|ตารางคะแนน|บาร์เซโลนา|เรอัล|บาเยิร์น|ยูเวนตุส|พรีเมียร์|epl|ucl|europa|มิลาน|ปารีส|psg|dortmund|inter|napoli|แข่งขัน|นัดชิง|รอบชิง|ถ่ายทอดสด|สกอร์|ประตู|แชมป์|running man|vs\b/i.test(t)) return "sports";
  if (/ดารา|หนัง|เพลง|ซีรี|ละคร|concert|anime|netflix|movie|kpop|idol|นักแสดง|ศิลปิน|เพลงฮิต|ภาพยนตร์|รางวัล|ออสการ์|grammy|บันเทิง|กระแส|ไวรัล|tiktok|youtube|mv|เรื่องย่อ|ช่อง|วาไรตี้|romance|scammer|blooms|bonnie|beauty.*infinity|melody|music.?awards|lmma|renjun|fan.?meet|fan.?sign|debut|comeback|lightstick|bias|ตอนจบ|ep\d/i.test(t)) return "entertainment";
  if (/การเมือง|เลือกตั้ง|นายก|รัฐบาล|สภา|กฎหมาย|ศาล|politics|พรรค|ส\.ส\.|ส\.ว\.|ครม\.|มติ|ประท้วง|ชุมนุม|รัฐธรรมนูญ|อภิปราย|งบประมาณ|ทหาร|กระทรวง|ข่าว|อุบัติเหตุ|น้ำท่วม|แผ่นดินไหว|ภัยพิบัติ|สึนามิ/i.test(t)) return "news";
  if (/หุ้น|ทอง|bitcoin|crypto|เศรษฐกิจ|ดอลลาร์|stock|economy|set|ตลาดหลักทรัพย์|เงินเฟ้อ|ดอกเบี้ย|ธนาคาร|กองทุน|ลงทุน|อสังหา|ค่าเงิน|บาท|eth|solana|defi|nft/i.test(t)) return "finance";
  if (/ai|เทคโนโลยี|tech|iphone|android|samsung|apple|google|microsoft|software|app|แอป|อัปเดต|gadget|robot|หุ่นยนต์|5g|6g|spacex|tesla|ev|รถยนต์ไฟฟ้า|chatgpt|gemini|claude|startup|coding|developer/i.test(t)) return "tech";
  return "general";
}

// GET /api/trends — parallel: Google Trends + X/Twitter Thailand
trends.get("/trends", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const categoryFilter = c.req.query("category");

  try {
    const data = await kvCache(c.env.KV, "trends:th:all", 900, async () => {
      // Parallel fetch both sources
      const [googleItems, xItems] = await Promise.all([
        fetchGoogleTrends(),
        fetchXTwitterTrends(),
      ]);

      const all = [...googleItems, ...xItems];
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
    const res = await fetch("https://trends24.in/thailand/");
    const html = await res.text();
    const tagRegex = /<a[^>]*href="https?:\/\/(?:twitter|x)\.com\/search[^"]*"[^>]*>([^<]+)<\/a>/gi;
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

export default trends;
