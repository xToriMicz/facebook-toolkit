import { Hono } from "hono";
import { Env, getSessionFromReq, kvCache } from "../helpers";

const shopee = new Hono<{ Bindings: Env }>();

type ShopeeItem = {
  name: string;
  image: string;
  price: number;
  sold: number;
  rating: number;
  category: string;
  shop_name: string;
  link: string;
};

const CATEGORIES = ["fashion", "electronics", "beauty", "home", "health"] as const;

// GET /api/shopee-trends
shopee.get("/shopee-trends", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const categoryFilter = c.req.query("category");

  try {
    const data = await kvCache(c.env.KV, "shopee:trending:v2", 900, async () => {
      const apifyKey = await c.env.KV.get("apify_api_key");
      const items = apifyKey ? await fetchFromApify(apifyKey) : getMockData();
      return { items, source: apifyKey ? "apify" : "mock", updated_at: new Date().toISOString() };
    });

    let filtered = data.items;
    if (categoryFilter && categoryFilter !== "all") {
      filtered = filtered.filter((item: ShopeeItem) => item.category === categoryFilter);
    }

    return c.json({ items: filtered, total: filtered.length, source: data.source, updated_at: data.updated_at });
  } catch {
    return c.json({ items: getMockData(), total: 0, source: "mock", updated_at: null });
  }
});

// GET /api/shopee-trends/status — check if API key is configured
shopee.get("/shopee-trends/status", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const hasKey = !!(await c.env.KV.get("apify_api_key"));
  return c.json({ configured: hasKey, source: hasKey ? "apify" : "mock" });
});

async function fetchFromApify(apiKey: string): Promise<ShopeeItem[]> {
  const items: ShopeeItem[] = [];
  try {
    // Apify Shopee Scraper — run actor and get results
    const runRes = await fetch("https://api.apify.com/v2/acts/voyager~shopee-scraper/run-sync-get-dataset-items?token=" + apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: "TH",
        searchQueries: ["best seller", "สินค้าขายดี", "แฟชั่น", "บิวตี้", "อิเล็กทรอนิกส์"],
        maxItems: 30,
        sortBy: "sales",
      }),
    });
    if (!runRes.ok) return getMockData();
    const results: any[] = await runRes.json();

    for (const r of results.slice(0, 50)) {
      items.push({
        name: r.name || r.title || "",
        image: r.image || r.imageUrl || "",
        price: r.price || r.currentPrice || 0,
        sold: r.sold || r.totalSold || 0,
        rating: r.rating || r.ratingAverage || 0,
        category: guessCategory(r.name || r.categoryName || ""),
        shop_name: r.shopName || r.shop?.name || "",
        link: r.url || r.link || "",
      });
    }
  } catch {}
  return items.length > 0 ? items : getMockData();
}

function guessCategory(name: string): string {
  const t = name.toLowerCase();
  if (/เสื้อ|กางเกง|กระเป๋า|รองเท้า|แฟชั่น|เดรส|fashion|shirt|shoe|bag/i.test(t)) return "fashion";
  if (/โทรศัพท์|หูฟัง|สาย.*ชาร์จ|phone|earbuds|charger|laptop|tablet|gadget/i.test(t)) return "electronics";
  if (/ครีม|เซรั่ม|สกินแคร์|แป้ง|ลิป|skincare|beauty|makeup|serum/i.test(t)) return "beauty";
  if (/บ้าน|ห้อง|ที่นอน|หมอน|ผ้า|home|bed|pillow|kitchen/i.test(t)) return "home";
  if (/วิตามิน|อาหารเสริม|สุขภาพ|protein|health|supplement/i.test(t)) return "health";
  return "fashion";
}

function getMockData(): ShopeeItem[] {
  return [
    { name: "เสื้อยืด Oversize Cotton 100%", image: "", price: 199, sold: 52000, rating: 4.8, category: "fashion", shop_name: "BangkokStyle", link: "https://shopee.co.th" },
    { name: "กางเกงขายาว ผ้าร่ม ทรง Jogger", image: "", price: 259, sold: 38000, rating: 4.7, category: "fashion", shop_name: "ThaiCasual", link: "https://shopee.co.th" },
    { name: "หูฟังบลูทูธ TWS ตัดเสียงรบกวน", image: "", price: 599, sold: 45000, rating: 4.6, category: "electronics", shop_name: "TechThai", link: "https://shopee.co.th" },
    { name: "สายชาร์จ USB-C 100W ชาร์จเร็ว", image: "", price: 89, sold: 120000, rating: 4.9, category: "electronics", shop_name: "GadgetPro", link: "https://shopee.co.th" },
    { name: "เคสโทรศัพท์ iPhone 15 กันกระแทก", image: "", price: 59, sold: 85000, rating: 4.5, category: "electronics", shop_name: "CaseMaster", link: "https://shopee.co.th" },
    { name: "เซรั่มวิตามินซี Brightening", image: "", price: 299, sold: 67000, rating: 4.8, category: "beauty", shop_name: "GlowThai", link: "https://shopee.co.th" },
    { name: "ครีมกันแดด SPF50+ PA++++", image: "", price: 189, sold: 92000, rating: 4.7, category: "beauty", shop_name: "SkinLab", link: "https://shopee.co.th" },
    { name: "แป้งฝุ่นคุมมัน เนื้อเนียน", image: "", price: 159, sold: 41000, rating: 4.6, category: "beauty", shop_name: "BeautyBox", link: "https://shopee.co.th" },
    { name: "ผ้าปูที่นอน 6 ฟุต เกรดโรงแรม", image: "", price: 499, sold: 28000, rating: 4.8, category: "home", shop_name: "HomePlus", link: "https://shopee.co.th" },
    { name: "หมอนยางพารา เพื่อสุขภาพ", image: "", price: 390, sold: 35000, rating: 4.7, category: "home", shop_name: "SleepWell", link: "https://shopee.co.th" },
    { name: "วิตามินซี 1000mg + Zinc", image: "", price: 250, sold: 78000, rating: 4.9, category: "health", shop_name: "VitaShop", link: "https://shopee.co.th" },
    { name: "Whey Protein Isolate 2lb", image: "", price: 890, sold: 15000, rating: 4.7, category: "health", shop_name: "FitStore", link: "https://shopee.co.th" },
  ];
}

export default shopee;
