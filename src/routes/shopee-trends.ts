import { Hono } from "hono";
import { Env, getSessionFromReq, kvCache } from "../helpers";

const shopee = new Hono<{ Bindings: Env }>();

type ShopeeItem = {
  name: string;
  image: string;
  price_min: number;
  price_max: number;
  sold: number;
  rating: number;
  reviews: number;
  category: string;
  shop_name: string;
  link: string;
};

// Shopee Thailand category IDs
const CATEGORIES: { id: number; name: string; keyword: string }[] = [
  { id: 11044546, name: "fashion", keyword: "แฟชั่น" },
  { id: 11044543, name: "electronics", keyword: "อิเล็กทรอนิกส์" },
  { id: 11044534, name: "beauty", keyword: "บิวตี้" },
  { id: 11044548, name: "home", keyword: "บ้าน" },
  { id: 11044553, name: "health", keyword: "สุขภาพ" },
];

// GET /api/shopee-trends
shopee.get("/shopee-trends", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const categoryFilter = c.req.query("category");

  try {
    const data = await kvCache(c.env.KV, "shopee:trending:v1", 900, async () => {
      const results = await Promise.all(
        CATEGORIES.map((cat) => fetchShopeeCategory(cat))
      );
      const all = results.flat();
      return { items: all, updated_at: new Date().toISOString() };
    });

    let filtered = data.items;
    if (categoryFilter && categoryFilter !== "all") {
      filtered = filtered.filter((item: ShopeeItem) => item.category === categoryFilter);
    }

    return c.json({ items: filtered, total: filtered.length, updated_at: data.updated_at });
  } catch {
    return c.json({ items: [], total: 0, updated_at: null });
  }
});

async function fetchShopeeCategory(cat: { id: number; name: string; keyword: string }): Promise<ShopeeItem[]> {
  const items: ShopeeItem[] = [];
  try {
    const url = `https://shopee.co.th/api/v4/search/search_items?by=sales&order=desc&limit=30&newest=0&match_id=${cat.id}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "th-TH,th;q=0.9",
        "Referer": "https://shopee.co.th/",
      },
    });
    if (!res.ok) return items;
    const data: any = await res.json();
    const searchItems = data?.items || data?.item || [];

    for (const raw of searchItems.slice(0, 30)) {
      const item = raw?.item_basic || raw;
      if (!item?.name) continue;

      const shopId = item.shopid || item.shop_id || 0;
      const itemId = item.itemid || item.item_id || 0;
      const imageHash = item.image || "";
      const image = imageHash
        ? `https://down-th.img.susercontent.com/file/${imageHash}`
        : "";

      items.push({
        name: item.name,
        image,
        price_min: (item.price_min || item.price || 0) / 100000,
        price_max: (item.price_max || item.price || 0) / 100000,
        sold: item.sold || item.historical_sold || 0,
        rating: item.item_rating?.rating_star || 0,
        reviews: item.item_rating?.rating_count?.[0] || item.cmt_count || 0,
        category: cat.name,
        shop_name: item.shop_name || "",
        link: `https://shopee.co.th/product/${shopId}/${itemId}`,
      });
    }
  } catch {}
  return items;
}

export default shopee;
