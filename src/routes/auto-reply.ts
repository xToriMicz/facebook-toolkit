import { Hono } from "hono";
import type { Env } from "../helpers";
import { getSessionFromReq, getDecryptedPageToken, sanitize } from "../helpers";
import { callAI } from "../ai-providers";

const autoReply = new Hono<{ Bindings: Env }>();

// ── Types ──

type CommentType = "question" | "praise" | "experience" | "disagree" | "tag_friend" | "emoji" | "spam" | "unclear";

interface ClassifiedComment {
  type: CommentType;
  confidence: number;
}

// ── AI Classification ──

const CLASSIFY_PROMPT = `คุณเป็นระบบวิเคราะห์ comment ของ Facebook page

วิเคราะห์ comment ต่อไปนี้แล้วจัดประเภท 1 ใน 8:
1. question — ถามข้อมูล เช่น "รถรุ่นนี้กี่ cc" "ราคาเท่าไหร่"
2. praise — ชม/เห็นด้วย เช่น "บทความดีมาก" "เขียนดี"
3. experience — แชร์ประสบการณ์ เช่น "ผมใช้อยู่ ประหยัดจริง"
4. disagree — ไม่เห็นด้วย เช่น "ไม่จริง" "ข้อมูลผิด"
5. tag_friend — แท็กเพื่อน เช่น "@friend ดูนี่"
6. emoji — emoji/สั้นๆ เช่น "❤️" "👍" "555" "สุดยอด"
7. spam — link spam, ขายของ, โฆษณา
8. unclear — ไม่ชัดเจน เช่น "อืม" "น่าสนใจ"

ตอบ JSON เท่านั้น: {"type":"ประเภท","confidence":0.0-1.0}`;

const REPLY_PROMPTS: Record<CommentType, string> = {
  question: `ตอบคำถามจาก comment ให้ข้อมูลที่เป็นประโยชน์ สุภาพ กระชับ 1-2 ประโยค ภาษาไทย ห้าม markdown ห้าม hashtag
ถ้าไม่รู้คำตอบ → บอกว่า "ขอบคุณที่สนใจค่ะ จะตอบกลับให้เร็วที่สุดนะคะ"`,

  praise: `ขอบคุณที่ชื่นชม ตอบสั้นๆ อบอุ่น 1 ประโยค ภาษาไทย ใส่ emoji 1-2 ตัว ห้าม markdown`,

  experience: `ชื่นชมที่แชร์ประสบการณ์ ถามต่อ 1 คำถาม สั้นๆ เป็นกันเอง ภาษาไทย ห้าม markdown`,

  disagree: `ตอบอย่างสุภาพ ให้ข้อมูลเพิ่มเติม ไม่ต่อล้อต่อเถียง 1-2 ประโยค ภาษาไทย ห้าม markdown`,

  tag_friend: `ขอบคุณที่แชร์ให้เพื่อน ตอบสั้นๆ สนุก 1 ประโยค ภาษาไทย ใส่ emoji ห้าม markdown`,

  emoji: `ตอบ emoji กลับ 1-3 ตัว เท่านั้น ไม่ต้องเขียนข้อความ`,

  spam: "", // ไม่ตอบ spam

  unclear: `ตอบเบาๆ เช่น "ขอบคุณที่แวะมาค่ะ 😊" หรือคล้ายๆ กัน สั้น 1 ประโยค ภาษาไทย ห้าม markdown`,
};

/** Classify a comment using AI */
async function classifyComment(
  comment: string,
  provider: string,
  apiKey: string,
  model: string,
  endpoint?: string,
): Promise<ClassifiedComment> {
  const result = await callAI(
    provider, apiKey, model,
    `${CLASSIFY_PROMPT}\n\nComment: "${comment}"`,
    endpoint,
  );

  try {
    let cleaned = result.text.trim();
    if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    return { type: parsed.type || "unclear", confidence: parsed.confidence || 0.5 };
  } catch {
    return { type: "unclear", confidence: 0.3 };
  }
}

/** Generate a reply based on comment type */
async function generateReply(
  comment: string,
  type: CommentType,
  provider: string,
  apiKey: string,
  model: string,
  endpoint?: string,
): Promise<string> {
  const prompt = REPLY_PROMPTS[type];
  if (!prompt) return "";

  const result = await callAI(
    provider, apiKey, model,
    `${prompt}\n\nComment ที่ต้องตอบ: "${comment}"\n\nตอบข้อความ reply เท่านั้น ไม่ต้องอธิบาย`,
    endpoint,
  );

  // Strip markdown and quotes
  let reply = result.text.trim();
  reply = reply.replace(/^["']|["']$/g, "");
  reply = reply.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  return reply;
}

/** Hide a spam comment */
async function hideComment(commentId: string, pageToken: string): Promise<boolean> {
  try {
    const res = await fetch(`https://graph.facebook.com/v25.0/${commentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_hidden: true, access_token: pageToken }),
    });
    const data = await res.json() as any;
    return data.success === true;
  } catch {
    return false;
  }
}

/** Reply to a comment via Facebook API */
async function replyToComment(commentId: string, message: string, pageToken: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch(`https://graph.facebook.com/v25.0/${commentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: pageToken }),
    });
    const data = await res.json() as any;
    if (data.error) return { ok: false, error: data.error.message };
    return { ok: true, id: data.id };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Sleep helper for delay between replies */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Cron: Process new comments ──

export async function processAutoReplies(env: Env) {
  const encKey = env.TOKEN_ENCRYPTION_KEY || env.FB_APP_SECRET;

  // Get all enabled page settings (per-page, exclude mode 'off')
  const { results: settings } = await env.DB.prepare(
    "SELECT ars.user_fb_id, ars.page_id, ars.reply_mode, up.page_token FROM auto_reply_settings ars JOIN user_pages up ON ars.user_fb_id = up.user_fb_id AND ars.page_id = up.page_id WHERE ars.enabled = 1 AND ars.reply_mode != 'off'"
  ).all();

  if (!settings.length) return;

  for (const setting of settings as any[]) {
    const fbId = setting.user_fb_id;
    const replyMode: string = setting.reply_mode || "all";
    const page = { page_id: setting.page_id, page_token: setting.page_token };

    // Get user's AI settings
    const aiSettings = await env.DB.prepare(
      "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
    ).bind(fbId).first<{ provider: string; model: string; api_key: string; endpoint_url: string }>();

    const provider = aiSettings?.provider || "anthropic";
    const apiKey = aiSettings?.api_key || env.ANTHROPIC_API_KEY;
    const model = aiSettings?.model || "claude-haiku-4-5-20251001";
    const endpoint = aiSettings?.endpoint_url;

    if (!apiKey) continue;

    {
      const pageToken = page.page_token.startsWith("enc:")
        ? await (async () => { try { const { decryptToken } = await import("../helpers"); return decryptToken(page.page_token, encKey); } catch { return null; } })()
        : page.page_token;
      if (!pageToken) continue;

      // Get recent posts (last 24h only — matches comment since parameter)
      const { results: posts } = await env.DB.prepare(
        "SELECT fb_post_id FROM posts WHERE user_fb_id = ? AND page_id = ? AND fb_post_id IS NOT NULL AND created_at > datetime('now', '-1 day') ORDER BY created_at DESC LIMIT 10"
      ).bind(fbId, page.page_id).all();

      for (const post of posts as any[]) {
        if (!post.fb_post_id) continue;

        // Fetch only recent comments (since 24h ago) to avoid replying to old ones
        const since = Math.floor(Date.now() / 1000) - 86400;
        let comments: any[];
        try {
          const res = await fetch(
            `https://graph.facebook.com/v25.0/${post.fb_post_id}/comments?fields=id,message,from,created_time&order=reverse_chronological&limit=25&since=${since}&access_token=${pageToken}`
          );
          const data = await res.json() as any;
          if (data.error) continue;
          comments = data.data || [];
        } catch {
          continue;
        }

        for (const comment of comments) {
          if (!comment.id || !comment.message) continue;

          // Skip if already processed in our DB
          const existing = await env.DB.prepare(
            "SELECT id FROM comment_replies WHERE comment_id = ?"
          ).bind(comment.id).first();
          if (existing) continue;

          // Skip own page comments (don't reply to ourselves)
          if (comment.from?.id === page.page_id) continue;

          // Check Facebook API for existing replies from our page (catches manual/legacy replies)
          try {
            const repliesRes = await fetch(
              `https://graph.facebook.com/v25.0/${comment.id}/comments?fields=from&limit=50&access_token=${pageToken}`
            );
            const repliesData = await repliesRes.json() as any;
            const alreadyReplied = (repliesData.data || []).some((r: any) => r.from?.id === page.page_id);
            if (alreadyReplied) {
              // Record in DB so we don't check again next tick
              await env.DB.prepare(
                "INSERT INTO comment_replies (user_fb_id, page_id, post_id, comment_id, comment_text, comment_from, comment_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'unknown', 'already_replied', ?)"
              ).bind(fbId, page.page_id, post.fb_post_id, comment.id, comment.message.slice(0, 500), comment.from?.name || "", new Date().toISOString()).run();
              continue;
            }
          } catch {
            // Non-critical: if check fails, proceed with caution (DB check already passed)
          }

          try {
            // Classify comment
            const classification = await classifyComment(comment.message, provider, apiKey, model, endpoint);

            // Handle spam: hide + log
            if (classification.type === "spam") {
              await hideComment(comment.id, pageToken);
              await env.DB.prepare(
                "INSERT INTO comment_replies (user_fb_id, page_id, post_id, comment_id, comment_text, comment_from, comment_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'spam', 'hidden', ?)"
              ).bind(fbId, page.page_id, post.fb_post_id, comment.id, comment.message.slice(0, 500), comment.from?.name || "", new Date().toISOString()).run();

              await env.DB.prepare(
                "INSERT INTO activity_logs (user_fb_id, action, detail, post_id, created_at) VALUES (?, 'auto_hide_spam', ?, ?, ?)"
              ).bind(fbId, `ซ่อน spam: ${comment.message.slice(0, 100)}`, post.fb_post_id, new Date().toISOString()).run();
              continue;
            }

            // Check reply mode before generating
            if (replyMode === "question_only" && classification.type !== "question" && classification.type !== "disagree") {
              // Log as skipped but don't reply
              await env.DB.prepare(
                "INSERT INTO comment_replies (user_fb_id, page_id, post_id, comment_id, comment_text, comment_from, comment_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', ?)"
              ).bind(fbId, page.page_id, post.fb_post_id, comment.id, comment.message.slice(0, 500), comment.from?.name || "", classification.type, new Date().toISOString()).run();
              continue;
            }
            if (replyMode === "random" && Math.random() > 0.7) {
              // 30% chance to skip (reply 60-80%)
              await env.DB.prepare(
                "INSERT INTO comment_replies (user_fb_id, page_id, post_id, comment_id, comment_text, comment_from, comment_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', ?)"
              ).bind(fbId, page.page_id, post.fb_post_id, comment.id, comment.message.slice(0, 500), comment.from?.name || "", classification.type, new Date().toISOString()).run();
              continue;
            }

            // Generate reply
            const replyText = await generateReply(comment.message, classification.type, provider, apiKey, model, endpoint);
            if (!replyText) continue;

            // Delay 2-5 seconds between replies
            await sleep(2000 + Math.random() * 3000);

            // Post reply
            const result = await replyToComment(comment.id, replyText, pageToken);

            // Save to DB
            await env.DB.prepare(
              "INSERT INTO comment_replies (user_fb_id, page_id, post_id, comment_id, comment_text, comment_from, comment_type, reply_text, reply_id, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(
              fbId, page.page_id, post.fb_post_id, comment.id,
              comment.message.slice(0, 500), comment.from?.name || "",
              classification.type, replyText, result.id || null,
              result.ok ? "replied" : "failed", result.error || null,
              new Date().toISOString(),
            ).run();

            // Log activity
            if (result.ok) {
              await env.DB.prepare(
                "INSERT INTO activity_logs (user_fb_id, action, detail, post_id, created_at) VALUES (?, 'auto_reply', ?, ?, ?)"
              ).bind(fbId, `[${classification.type}] ${replyText.slice(0, 150)}`, post.fb_post_id, new Date().toISOString()).run();
            }
          } catch {
            // Non-critical: skip this comment
          }
        }
      }
    }
  }
}

// ── Cron: Cleanup old comment_replies (>90 days) ──

export async function cleanupOldReplies(env: Env) {
  await env.DB.prepare(
    "DELETE FROM comment_replies WHERE created_at < datetime('now', '-90 days')"
  ).run();
}

// ── API Routes ──

// GET /api/auto-reply/settings?page_id=xxx
autoReply.get("/auto-reply/settings", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const pageId = c.req.query("page_id");
  if (pageId) {
    // Single page setting
    const row = await c.env.DB.prepare(
      "SELECT enabled, reply_mode FROM auto_reply_settings WHERE user_fb_id = ? AND page_id = ?"
    ).bind(session.fb_id, pageId).first<{ enabled: number; reply_mode: string }>();
    return c.json({ page_id: pageId, enabled: row?.enabled === 1, reply_mode: row?.reply_mode || "all" });
  }

  // All pages settings
  const { results } = await c.env.DB.prepare(
    "SELECT ars.page_id, ars.enabled, ars.reply_mode, up.page_name FROM auto_reply_settings ars LEFT JOIN user_pages up ON ars.page_id = up.page_id AND ars.user_fb_id = up.user_fb_id WHERE ars.user_fb_id = ?"
  ).bind(session.fb_id).all();
  return c.json({ pages: results });
});

// POST /api/auto-reply/settings
autoReply.post("/auto-reply/settings", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { enabled, page_id, reply_mode } = await c.req.json() as { enabled: boolean; page_id: string; reply_mode?: string };
  if (!page_id) return c.json({ error: "page_id required" }, 400);

  const validModes = ["all", "random", "question_only", "off"];
  const mode = reply_mode && validModes.includes(reply_mode) ? reply_mode : "all";

  // Verify user owns this page
  const page = await c.env.DB.prepare(
    "SELECT page_id FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, page_id).first();
  if (!page) return c.json({ error: "Page not found" }, 400);

  await c.env.DB.prepare(
    "INSERT INTO auto_reply_settings (user_fb_id, page_id, enabled, reply_mode) VALUES (?, ?, ?, ?) ON CONFLICT(user_fb_id, page_id) DO UPDATE SET enabled = excluded.enabled, reply_mode = excluded.reply_mode"
  ).bind(session.fb_id, page_id, enabled ? 1 : 0, mode).run();

  return c.json({ ok: true, page_id, enabled, reply_mode: mode });
});

// GET /api/auto-reply/history?date=YYYY-MM-DD
autoReply.get("/auto-reply/history", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const limit = Math.min(50, +(c.req.query("limit") || "20"));
  const date = c.req.query("date");

  // Validate date format if provided
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: "Invalid date format, use YYYY-MM-DD" }, 400);
  }

  const { results } = date
    ? await c.env.DB.prepare(
        "SELECT cr.*, p.message as post_message FROM comment_replies cr LEFT JOIN posts p ON cr.post_id = p.fb_post_id AND cr.user_fb_id = p.user_fb_id WHERE cr.user_fb_id = ? AND date(cr.created_at) = ? ORDER BY cr.created_at DESC LIMIT ?"
      ).bind(session.fb_id, date, limit).all()
    : await c.env.DB.prepare(
        "SELECT cr.*, p.message as post_message FROM comment_replies cr LEFT JOIN posts p ON cr.post_id = p.fb_post_id AND cr.user_fb_id = p.user_fb_id WHERE cr.user_fb_id = ? ORDER BY cr.created_at DESC LIMIT ?"
      ).bind(session.fb_id, limit).all();

  return c.json({ replies: results, total: results.length });
});

export default autoReply;
