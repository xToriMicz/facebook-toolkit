import { Hono } from "hono";
import type { Env } from "../helpers";
import { getSessionFromReq, getDecryptedPageToken } from "../helpers";
import { callAI } from "../ai-providers";

const outbound = new Hono<{ Bindings: Env }>();

// ── Types ──

type PostType = "informative" | "question" | "product" | "story" | "meme" | "personal_grief" | "political" | "controversial" | "ad_sponsored" | "image_only" | "other";

const SKIP_TYPES: PostType[] = ["personal_grief", "political", "controversial", "ad_sponsored", "image_only"];

// ── AI Classification ──

const CLASSIFY_POST_PROMPT = `คุณเป็นระบบวิเคราะห์โพส Facebook

วิเคราะห์โพสต่อไปนี้แล้วจัดประเภท 1 ใน 11:
1. informative — โพสข้อมูล/ข่าว/ให้ความรู้
2. question — โพสถามความเห็น/ถามคำถาม
3. product — โพสสินค้า/บริการ/รีวิว
4. story — โพสเล่าเรื่อง/ประสบการณ์
5. meme — โพสตลก/meme/สนุกๆ
6. personal_grief — โพสส่วนตัวมาก/เรื่องเศร้า/สูญเสีย
7. political — โพสการเมือง/ฝักฝ่าย
8. controversial — โพสขัดแย้ง/sensitive/ถกเถียง
9. ad_sponsored — โพสโฆษณา/sponsored/ขายของ
10. image_only — รูปอย่างเดียว ไม่มีข้อความ
11. other — อื่นๆ ที่ไม่เข้าหมวดไหน

ตอบ JSON เท่านั้น: {"type":"ประเภท","confidence":0.0-1.0}`;

const COMMENT_PROMPT = `คุณเป็นคนจริงที่กำลังอ่าน Facebook แล้วเจอโพสนี้ สร้าง comment ที่เป็นธรรมชาติ

กฎสำคัญ:
- ห้าม markdown, hashtag, URL, @mention, emoji เกิน 1 ตัว
- ห้ามขายของ/โฆษณา/แนะนำสินค้า
- ห้ามใส่เบอร์โทร/email/ข้อมูลส่วนตัว
- สั้น 1-2 ประโยค (max 200 ตัวอักษร)
- ภาษาเดียวกับโพส
- ต้องเกี่ยวข้องกับเนื้อหาโพส ห้าม generic
- หลากหลาย ไม่ซ้ำ template เดิม`;

// ── Helpers ──

/** Sanitize text for AI prompt */
function sanitize(text: string): string {
  return text
    .slice(0, 500)
    .replace(/ignore\s+(above|previous|all)\s+instructions?/gi, "[filtered]")
    .replace(/system\s*prompt/gi, "[filtered]")
    .replace(/you\s+are\s+(now|a)\s/gi, "[filtered]")
    .trim();
}

/** Filter outbound comment content before sending */
function filterComment(text: string): string | null {
  let c = text.trim();
  // Strip unwanted content
  c = c.replace(/https?:\/\/\S+/g, ""); // URLs
  c = c.replace(/#\S+/g, ""); // hashtags
  c = c.replace(/@\S+/g, ""); // @mentions
  c = c.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1"); // markdown
  c = c.replace(/^["']|["']$/g, ""); // quotes
  c = c.slice(0, 200).trim();
  // Reject if too short or empty
  if (c.length < 5) return null;
  // Reject phone numbers, emails, sales pitch
  if (/\d{9,}/.test(c)) return null; // phone number
  if (/\S+@\S+\.\S+/.test(c)) return null; // email
  if (/ราคา.*บาท|สั่งซื้อ|line\s*:?\s*@|ติดต่อ.*สอบถาม|โปรโมช|ส่วนลด|คลิก/i.test(c)) return null; // sales pitch
  return c;
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Constants ──

const MAX_TARGETS_PER_USER = 5;
const MAX_DRAFTS_PER_RUN = 10; // max drafts to generate per cron run
const DAILY_CAP_DEFAULT = 5; // total outbound comments per day across all targets

// ── Cron: Generate draft comments for approval ──

export async function processOutboundComments(env: Env) {
  const encKey = env.TOKEN_ENCRYPTION_KEY || env.FB_APP_SECRET;

  // Throttle: only run every 30 minutes (use KV)
  const lastRun = await env.KV.get("cron:outbound:last");
  if (lastRun && Date.now() - parseInt(lastRun) < 1800000) return;
  await env.KV.put("cron:outbound:last", Date.now().toString());

  // Get all enabled targets grouped by user
  const { results: targets } = await env.DB.prepare(
    "SELECT tp.*, up.page_token FROM target_pages tp JOIN user_pages up ON tp.user_fb_id = up.user_fb_id AND tp.page_id = up.page_id WHERE tp.enabled = 1"
  ).all();

  if (!targets.length) return;

  // Group by user
  const userTargets: Record<string, any[]> = {};
  for (const t of targets as any[]) {
    if (!userTargets[t.user_fb_id]) userTargets[t.user_fb_id] = [];
    userTargets[t.user_fb_id].push(t);
  }

  for (const [fbId, pageTargets] of Object.entries(userTargets)) {
    // Check daily cap
    const today = new Date().toISOString().split("T")[0];
    const { results: todayCount } = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM outbound_comments WHERE user_fb_id = ? AND status IN ('sent', 'approved') AND date(created_at) = ?"
    ).bind(fbId, today).all();
    const sentToday = (todayCount[0] as any)?.count || 0;
    if (sentToday >= DAILY_CAP_DEFAULT) continue;

    // Get user's AI settings
    const aiSettings = await env.DB.prepare(
      "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
    ).bind(fbId).first<{ provider: string; model: string; api_key: string; endpoint_url: string }>();

    const provider = aiSettings?.provider || "anthropic";
    const apiKey = aiSettings?.api_key || env.ANTHROPIC_API_KEY;
    const model = aiSettings?.model || "claude-haiku-4-5-20251001";
    const endpoint = aiSettings?.endpoint_url;
    if (!apiKey) continue;

    let draftsThisRun = 0;

    for (const target of pageTargets) {
      if (draftsThisRun >= MAX_DRAFTS_PER_RUN) break;

      // Check per-target daily limit
      const { results: targetToday } = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM outbound_comments WHERE user_fb_id = ? AND target_page_id = ? AND status IN ('sent', 'approved', 'pending') AND date(created_at) = ?"
      ).bind(fbId, target.target_page_id, today).all();
      const targetSentToday = (targetToday[0] as any)?.count || 0;
      if (targetSentToday >= (target.max_per_day || 1)) continue;

      const pageToken = target.page_token.startsWith("enc:")
        ? await (async () => { try { const { decryptToken } = await import("../helpers"); return decryptToken(target.page_token, encKey); } catch { return null; } })()
        : target.page_token;
      if (!pageToken) continue;

      // Fetch recent posts from target page
      let posts: any[];
      try {
        const res = await fetch(
          `https://graph.facebook.com/v25.0/${target.target_page_id}/feed?fields=id,message,created_time,type&limit=5&access_token=${pageToken}`
        );
        const data = await res.json() as any;
        if (data.error) continue;
        posts = data.data || [];
      } catch {
        continue;
      }

      for (const post of posts) {
        if (draftsThisRun >= MAX_DRAFTS_PER_RUN) break;
        if (!post.id || !post.message) continue; // skip image-only posts

        // Check if we already commented/drafted on this post
        const existing = await env.DB.prepare(
          "SELECT id FROM outbound_comments WHERE target_post_id = ? AND user_fb_id = ?"
        ).bind(post.id, fbId).first();
        if (existing) continue;

        // Skip rate: 30-50% chance to skip
        if (Math.random() > 0.6) {
          await env.DB.prepare(
            "INSERT INTO outbound_comments (user_fb_id, page_id, target_page_id, target_post_id, post_message, post_type, comment_text, status, created_at) VALUES (?, ?, ?, ?, ?, 'skipped', '', 'skipped', ?)"
          ).bind(fbId, target.page_id, target.target_page_id, post.id, (post.message || "").slice(0, 500), new Date().toISOString()).run();
          continue;
        }

        try {
          // Classify post type
          const classResult = await callAI(
            provider, apiKey, model,
            `${CLASSIFY_POST_PROMPT}\n\nโพส: "${sanitize(post.message)}"`,
            endpoint,
          );
          let postType: PostType = "other";
          try {
            let cleaned = classResult.text.trim();
            if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
            const parsed = JSON.parse(cleaned);
            postType = parsed.type || "other";
          } catch { /* keep default */ }

          // Skip unsafe post types
          if (SKIP_TYPES.includes(postType)) {
            await env.DB.prepare(
              "INSERT INTO outbound_comments (user_fb_id, page_id, target_page_id, target_post_id, post_message, post_type, comment_text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, '', 'skipped', ?)"
            ).bind(fbId, target.page_id, target.target_page_id, post.id, (post.message || "").slice(0, 500), postType, new Date().toISOString()).run();
            continue;
          }

          // Generate comment draft
          const toneInstruction = target.comment_tone === "formal" ? "\nใช้ภาษาสุภาพ ค่ะ/ครับ" :
            target.comment_tone === "custom" && target.custom_prompt ? `\nสไตล์: ${target.custom_prompt.slice(0, 200)}` :
            "\nใช้ภาษาเป็นกันเอง เช่น นะ จ้า ค่า";

          const result = await callAI(
            provider, apiKey, model,
            `${COMMENT_PROMPT}${toneInstruction}\n\nโพส: "${sanitize(post.message)}"\nประเภทโพส: ${postType}\n\nสร้าง comment เท่านั้น ไม่ต้องอธิบาย`,
            endpoint,
          );

          const commentText = filterComment(result.text);
          if (!commentText) continue;

          // Full auto: save as approved → sendApprovedComments จะส่งเอง
          await env.DB.prepare(
            "INSERT INTO outbound_comments (user_fb_id, page_id, target_page_id, target_post_id, post_message, post_type, comment_text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?)"
          ).bind(fbId, target.page_id, target.target_page_id, post.id, (post.message || "").slice(0, 500), postType, commentText, new Date().toISOString()).run();

          draftsThisRun++;
        } catch {
          // Non-critical: skip this post
        }
      }
    }
  }
}

// ── Send approved comment to Facebook ──

async function sendComment(commentId: number, env: Env): Promise<{ ok: boolean; fbCommentId?: string; error?: string }> {
  const encKey = env.TOKEN_ENCRYPTION_KEY || env.FB_APP_SECRET;

  const row = await env.DB.prepare(
    "SELECT oc.*, up.page_token FROM outbound_comments oc JOIN user_pages up ON oc.user_fb_id = up.user_fb_id AND oc.page_id = up.page_id WHERE oc.id = ? AND oc.status = 'approved'"
  ).bind(commentId).first<any>();

  if (!row) return { ok: false, error: "Comment not found or not approved" };

  const pageToken = row.page_token.startsWith("enc:")
    ? await (async () => { try { const { decryptToken } = await import("../helpers"); return decryptToken(row.page_token, encKey); } catch { return null; } })()
    : row.page_token;
  if (!pageToken) return { ok: false, error: "Invalid page token" };

  // Random delay 2-10 seconds
  await sleep(2000 + Math.random() * 8000);

  try {
    const res = await fetch(`https://graph.facebook.com/v25.0/${row.target_post_id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: row.comment_text, access_token: pageToken }),
    });
    const data = await res.json() as any;

    if (data.error) {
      await env.DB.prepare("UPDATE outbound_comments SET status = 'failed', error_message = ? WHERE id = ?")
        .bind(data.error.message, commentId).run();
      return { ok: false, error: data.error.message };
    }

    await env.DB.prepare("UPDATE outbound_comments SET status = 'sent', comment_id = ? WHERE id = ?")
      .bind(data.id, commentId).run();
    // Update last_commented_at on target page
    await env.DB.prepare("UPDATE target_pages SET last_commented_at = ? WHERE user_fb_id = ? AND target_page_id = ?")
      .bind(new Date().toISOString(), row.user_fb_id, row.target_page_id).run();
    return { ok: true, fbCommentId: data.id };
  } catch (e: any) {
    await env.DB.prepare("UPDATE outbound_comments SET status = 'failed', error_message = ? WHERE id = ?")
      .bind(e.message, commentId).run();
    return { ok: false, error: e.message };
  }
}

// ── Cron: Send approved comments ──

export async function sendApprovedComments(env: Env) {
  // Get approved comments — join target_pages for cooldown check
  const { results } = await env.DB.prepare(
    "SELECT oc.id, oc.target_page_id, tp.last_commented_at FROM outbound_comments oc LEFT JOIN target_pages tp ON oc.target_page_id = tp.target_page_id AND oc.user_fb_id = tp.user_fb_id WHERE oc.status = 'approved' ORDER BY oc.created_at ASC LIMIT 5"
  ).all();

  for (const row of results as any[]) {
    // Cooldown: skip if last comment to this target was < 2 hours ago
    if (row.last_commented_at) {
      const elapsed = Date.now() - new Date(row.last_commented_at).getTime();
      if (elapsed < 7200000) continue; // 2 hours
    }
    await sendComment(row.id, env);
    // Cooldown between sends
    await sleep(5000 + Math.random() * 10000);
  }
}

// ── API Routes ──

// GET /api/outbound/targets — list target pages
outbound.get("/outbound/targets", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM target_pages WHERE user_fb_id = ? ORDER BY created_at DESC"
  ).bind(session.fb_id).all();
  return c.json({ targets: results });
});

// POST /api/outbound/targets — add target page
outbound.post("/outbound/targets", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { page_id, target_page_id, target_page_name, target_page_url, max_per_day, comment_tone, custom_prompt } = await c.req.json() as any;
  if (!page_id || !target_page_id) return c.json({ error: "page_id and target_page_id required" }, 400);

  // Check user limit
  const { results: existing } = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM target_pages WHERE user_fb_id = ?"
  ).bind(session.fb_id).all();
  if (((existing[0] as any)?.count || 0) >= MAX_TARGETS_PER_USER) {
    return c.json({ error: `Max ${MAX_TARGETS_PER_USER} target pages allowed` }, 400);
  }

  await c.env.DB.prepare(
    "INSERT INTO target_pages (user_fb_id, page_id, target_page_id, target_page_name, target_page_url, max_per_day, comment_tone, custom_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_fb_id, page_id, target_page_id) DO UPDATE SET target_page_name = excluded.target_page_name, enabled = 1, max_per_day = excluded.max_per_day, comment_tone = excluded.comment_tone, custom_prompt = excluded.custom_prompt"
  ).bind(session.fb_id, page_id, target_page_id, target_page_name || "", target_page_url || "", max_per_day || 1, comment_tone || "casual", custom_prompt || "").run();

  return c.json({ ok: true });
});

// DELETE /api/outbound/targets/:id — remove target
outbound.delete("/outbound/targets/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");

  await c.env.DB.prepare("DELETE FROM target_pages WHERE id = ? AND user_fb_id = ?")
    .bind(id, session.fb_id).run();
  return c.json({ ok: true });
});

// PATCH /api/outbound/targets/:id — toggle enabled
outbound.patch("/outbound/targets/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  const { enabled } = await c.req.json() as { enabled: boolean };

  await c.env.DB.prepare("UPDATE target_pages SET enabled = ? WHERE id = ? AND user_fb_id = ?")
    .bind(enabled ? 1 : 0, id, session.fb_id).run();
  return c.json({ ok: true });
});

// GET /api/outbound/queue — pending drafts for approval
outbound.get("/outbound/queue", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { results } = await c.env.DB.prepare(
    "SELECT oc.*, tp.target_page_name FROM outbound_comments oc LEFT JOIN target_pages tp ON oc.target_page_id = tp.target_page_id AND oc.user_fb_id = tp.user_fb_id WHERE oc.user_fb_id = ? AND oc.status = 'pending' ORDER BY oc.created_at DESC LIMIT 20"
  ).bind(session.fb_id).all();
  return c.json({ queue: results });
});

// POST /api/outbound/approve/:id — approve a draft
outbound.post("/outbound/approve/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");
  const { comment_text } = await c.req.json() as { comment_text?: string };

  // Allow user to edit comment before approving
  if (comment_text) {
    const filtered = filterComment(comment_text);
    if (!filtered) return c.json({ error: "Comment too short or invalid" }, 400);
    await c.env.DB.prepare("UPDATE outbound_comments SET comment_text = ?, status = 'approved' WHERE id = ? AND user_fb_id = ? AND status = 'pending'")
      .bind(filtered, id, session.fb_id).run();
  } else {
    await c.env.DB.prepare("UPDATE outbound_comments SET status = 'approved' WHERE id = ? AND user_fb_id = ? AND status = 'pending'")
      .bind(id, session.fb_id).run();
  }

  return c.json({ ok: true });
});

// POST /api/outbound/reject/:id — reject a draft
outbound.post("/outbound/reject/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const id = c.req.param("id");

  await c.env.DB.prepare("UPDATE outbound_comments SET status = 'rejected' WHERE id = ? AND user_fb_id = ? AND status = 'pending'")
    .bind(id, session.fb_id).run();
  return c.json({ ok: true });
});

// GET /api/outbound/history — sent comments history
outbound.get("/outbound/history", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const limit = Math.min(50, +(c.req.query("limit") || "20"));

  const { results } = await c.env.DB.prepare(
    "SELECT oc.*, tp.target_page_name FROM outbound_comments oc LEFT JOIN target_pages tp ON oc.target_page_id = tp.target_page_id AND oc.user_fb_id = tp.user_fb_id WHERE oc.user_fb_id = ? AND oc.status != 'pending' ORDER BY oc.created_at DESC LIMIT ?"
  ).bind(session.fb_id, limit).all();
  return c.json({ comments: results, total: results.length });
});

export default outbound;
