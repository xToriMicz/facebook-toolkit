import { Hono } from "hono";
import type { Env } from "../helpers";
import { getSessionFromReq, getDecryptedPageToken, sanitize } from "../helpers";
import { callAI } from "../ai-providers";
import { createNotification } from "./notifications";

const autoReply = new Hono<{ Bindings: Env }>();

// ── Types ──

type CommentType = "question" | "praise" | "experience" | "disagree" | "complaint" | "greeting" | "short_reaction" | "tag_friend" | "emoji" | "spam";

interface ClassifiedComment {
  type: CommentType;
  confidence: number;
}

// ── AI Classification ──

const CLASSIFY_PROMPT = `คุณเป็นระบบวิเคราะห์ comment ของ Facebook page

วิเคราะห์ comment ต่อไปนี้แล้วจัดประเภท 1 ใน 10:
1. question — ถามข้อมูล เช่น "รถรุ่นนี้กี่ cc" "ราคาเท่าไหร่" "สั่งยังไง"
2. praise — ชม/เห็นด้วย เช่น "บทความดีมาก" "เขียนดี" "เยี่ยมเลย"
3. experience — แชร์ประสบการณ์ยาว เช่น "ผมใช้อยู่ ประหยัดจริง" "เพชรบุรีก็ร้อนมากค่ะ"
4. disagree — ไม่เห็นด้วยกับเนื้อหาโพส เช่น "ไม่จริง" "ข้อมูลผิด"
5. complaint — บ่น/ระบาย (ไม่ใช่ disagree กับเพจ) เช่น "แย่จังอากาศ" "ร้อนจัง" "ผิดหวัง"
6. greeting — ทักทาย/อวยพร เช่น "สวัสดีครับ" "อรุณสวัสดิ์" "หวัดดี" "กลับค่า" "Hi"
7. short_reaction — ข้อความสั้น 1-3 คำ ที่ไม่ใช่ emoji เช่น "สุดยอด" "ร้อนสุดๆ" "น่าทาน" "เก่งมาก"
8. tag_friend — แท็กเพื่อน เช่น "@friend ดูนี่"
9. emoji — emoji ล้วนๆ หรือ "555" "5555" เช่น "❤️" "👍" "✌️✌️"
10. spam — link spam, ขายของ, โฆษณา

สำคัญ: greeting = ทักทาย/ลา, short_reaction = คำสั้นแสดงความรู้สึก, emoji = สัญลักษณ์ล้วน
ตอบ JSON เท่านั้น: {"type":"ประเภท","confidence":0.0-1.0}`;

const REPLY_PROMPTS: Record<CommentType, string> = {
  question: `ตอบคำถามจาก comment ให้ข้อมูลที่เป็นประโยชน์ สุภาพ กระชับ 1-2 ประโยค ภาษาไทย ห้าม markdown ห้าม hashtag
ถ้าไม่รู้คำตอบ → บอกว่า "ขอบคุณที่สนใจค่ะ จะตอบกลับให้เร็วที่สุดนะคะ"`,

  praise: `ขอบคุณที่ชื่นชม ตอบสั้นๆ อบอุ่น 1 ประโยค ภาษาไทย ใส่ emoji 1-2 ตัว ห้าม markdown`,

  experience: `ชื่นชมที่แชร์ประสบการณ์ ถามต่อ 1 คำถาม สั้นๆ เป็นกันเอง ภาษาไทย ห้าม markdown`,

  disagree: `ตอบอย่างสุภาพ ให้ข้อมูลเพิ่มเติม ไม่ต่อล้อต่อเถียง 1-2 ประโยค ภาษาไทย ห้าม markdown`,

  complaint: `เห็นใจที่เจอสถานการณ์แบบนั้น ตอบอบอุ่น 1-2 ประโยค ภาษาไทย ห้าม markdown ห้ามแนะนำเว้นแต่เขาถาม`,

  greeting: `ทักทายกลับสั้นๆ อบอุ่น 1 ประโยค ภาษาไทย ใส่ emoji 1 ตัว ห้าม markdown เช่น ถ้าเขาบอก "สวัสดี" ก็ตอบ "สวัสดีค่ะ 😊"`,

  short_reaction: `ตอบสั้นๆ เป็นกันเอง 1 ประโยค ภาษาไทย ใส่ emoji 1 ตัว ห้าม markdown`,

  tag_friend: `ขอบคุณที่แชร์ให้เพื่อน ตอบสั้นๆ สนุก 1 ประโยค ภาษาไทย ใส่ emoji ห้าม markdown`,

  emoji: `ตอบ emoji กลับ 1-3 ตัว เท่านั้น ไม่ต้องเขียนข้อความ`,

  spam: "", // ไม่ตอบ spam
};

/** Sanitize comment text — strip potential prompt injection */
function sanitizeComment(text: string): string {
  return text
    .slice(0, 300) // limit length
    .replace(/ignore\s+(above|previous|all)\s+instructions?/gi, "[filtered]")
    .replace(/system\s*prompt/gi, "[filtered]")
    .replace(/you\s+are\s+(now|a)\s/gi, "[filtered]")
    .trim();
}

/** Max replies per cron run per page — prevent subrequest limit burst */
const MAX_REPLIES_PER_RUN = 10;

/** Classify a comment using AI */
async function classifyComment(
  comment: string,
  provider: string,
  apiKey: string,
  model: string,
  endpoint?: string,
  postContext?: string,
): Promise<ClassifiedComment> {
  const contextLine = postContext ? `\n\nโพสต้นทาง: "${postContext.slice(0, 200)}"` : "";
  const result = await callAI(
    provider, apiKey, model,
    `${CLASSIFY_PROMPT}${contextLine}\n\nComment: "${sanitizeComment(comment)}"`,
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
  postContext?: string,
  tone?: string,
  customTone?: string,
): Promise<string> {
  const prompt = REPLY_PROMPTS[type];
  if (!prompt) return "";

  const toneInstruction = tone === "casual" ? "\nใช้ภาษาเป็นกันเอง เช่น นะ จ้า ค่า" :
    tone === "custom" && customTone ? `\nสไตล์การตอบ: ${customTone.slice(0, 200)}` :
    "\nใช้ภาษาสุภาพ เช่น ค่ะ ครับ";
  const contextLine = postContext ? `\nเนื้อหาโพส: "${postContext.slice(0, 200)}"` : "";

  const result = await callAI(
    provider, apiKey, model,
    `${prompt}${toneInstruction}${contextLine}\n\nComment ที่ต้องตอบ: "${sanitizeComment(comment)}"\n\nตอบข้อความ reply เท่านั้น ไม่ต้องอธิบาย`,
    endpoint,
  );

  // Strip markdown, quotes, URLs
  let reply = result.text.trim();
  reply = reply.replace(/^["']|["']$/g, "");
  reply = reply.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  reply = reply.replace(/https?:\/\/\S+/g, ""); // strip URLs from reply
  reply = reply.slice(0, 500); // max reply length
  return reply.trim();
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

/** Like a comment via Facebook API — fail silently, never blocks reply */
async function likeComment(commentId: string, pageToken: string): Promise<boolean> {
  try {
    const res = await fetch(`https://graph.facebook.com/v25.0/${commentId}/likes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: pageToken }),
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

  // Get all enabled page settings (per-page, exclude mode 'off') — include tone + skip_greeting + custom_tone
  const { results: settings } = await env.DB.prepare(
    "SELECT ars.user_fb_id, ars.page_id, ars.reply_mode, ars.reply_tone, ars.skip_greeting, ars.custom_tone, up.page_token FROM auto_reply_settings ars JOIN user_pages up ON ars.user_fb_id = up.user_fb_id AND ars.page_id = up.page_id WHERE ars.enabled = 1 AND ars.reply_mode != 'off'"
  ).all();

  if (!settings.length) return;

  for (const setting of settings as any[]) {
    const fbId = setting.user_fb_id;
    const replyMode: string = setting.reply_mode || "all";
    const replyTone: string = setting.reply_tone || "formal";
    const customToneText: string = setting.custom_tone || "";
    const skipGreeting: boolean = setting.skip_greeting === 1;
    const page = { page_id: setting.page_id, page_token: setting.page_token };
    let repliesThisRun = 0;

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

      // Get recent posts from Graph API (catches posts made outside toolkit)
      let posts: any[] = [];
      try {
        const feedRes = await fetch(
          `https://graph.facebook.com/v25.0/${page.page_id}/posts?fields=id,message,created_time&limit=10&access_token=${pageToken}`
        );
        const feedData = await feedRes.json() as any;
        if (feedData.data) {
          posts = feedData.data.map((p: any) => ({ fb_post_id: p.id, message: p.message || "", created_at: p.created_time }));
          // Sync posts to DB — strip pageId_ prefix to match existing format
          for (const p of posts) {
            const shortId = p.fb_post_id.includes("_") ? p.fb_post_id.split("_").pop() : p.fb_post_id;
            await env.DB.prepare(
              "INSERT OR IGNORE INTO posts (fb_post_id, page_id, user_fb_id, message, status, created_at) VALUES (?, ?, ?, ?, 'posted', ?)"
            ).bind(shortId, page.page_id, fbId, p.message.slice(0, 2000), p.created_at).run();
          }
        }
      } catch (e: any) {
        await createNotification(env.DB, fbId, { page_id: page.page_id, type: "error", priority: "normal", title: "❌ Feed fetch error", detail: `${e.message}`.slice(0, 200) }).catch(() => {});
        // Fallback to DB if Graph API fails
        const { results: dbPosts } = await env.DB.prepare(
          "SELECT fb_post_id, created_at, message FROM posts WHERE user_fb_id = ? AND page_id = ? AND fb_post_id IS NOT NULL AND created_at > datetime('now', '-3 days') ORDER BY created_at DESC LIMIT 10"
        ).bind(fbId, page.page_id).all();
        posts = dbPosts as any[];
      }

      const nowMs = Date.now();
      // ดึง comment ย้อนหลัง 24 ชม. — จับ comment จากโพสที่สร้างนอก toolkit ด้วย
      // DB dedup ป้องกัน reply ซ้ำ — ขยาย window ปลอดภัย
      const sinceParam = `&since=${Math.floor(nowMs / 1000) - 86400}`;
      // Dedup posts — same post can have 2 IDs (toolkit vs Graph API sync)
      const seenPostIds = new Set<string>();
      for (const post of posts as any[]) {
        if (!post.fb_post_id) continue;
        // Normalize: strip pageId_ prefix for DB consistency
        const postId = post.fb_post_id.includes("_") ? post.fb_post_id.split("_").pop() : post.fb_post_id;
        // Skip duplicate posts (same post can have 2 IDs)
        if (seenPostIds.has(postId)) continue;
        seenPostIds.add(postId);

        let comments: any[];
        try {
          const res = await fetch(
            `https://graph.facebook.com/v25.0/${post.fb_post_id}/comments?fields=id,message,from,created_time,attachment&order=reverse_chronological&limit=25${sinceParam}&access_token=${pageToken}`
          );
          const data = await res.json() as any;
          if (data.error) {
            await createNotification(env.DB, fbId, { page_id: page.page_id, type: "error", priority: "normal", title: "❌ Comment fetch error", detail: `Post ${postId}: ${data.error.message || JSON.stringify(data.error)}`.slice(0, 200) });
            continue;
          }
          comments = data.data || [];
        } catch (e: any) {
          await createNotification(env.DB, fbId, { page_id: page.page_id, type: "error", priority: "normal", title: "❌ Comment fetch exception", detail: `Post ${postId}: ${e.message}`.slice(0, 200) }).catch(() => {});
          continue;
        }

        for (const comment of comments) {
          if (!comment.id) continue;
          // Sticker/image-only comments (no text): give placeholder so AI can reply
          if (!comment.message) comment.message = "[sticker]";

          // Skip if already processed in our DB
          const existing = await env.DB.prepare(
            "SELECT id FROM comment_replies WHERE comment_id = ?"
          ).bind(comment.id).first();
          if (existing) continue;

          // Skip own page comments (don't reply to ourselves)
          if (comment.from?.id === page.page_id) continue;

          // Check Facebook API for existing replies from our page (any reply counts)
          try {
            const repliesRes = await fetch(
              `https://graph.facebook.com/v25.0/${comment.id}/comments?fields=from&limit=50&access_token=${pageToken}`
            );
            const repliesData = await repliesRes.json() as any;
            const alreadyReplied = (repliesData.data || []).some((r: any) => r.from?.id === page.page_id);
            if (alreadyReplied) {
              // Record in DB so we don't check again next tick
              await env.DB.prepare(
                "INSERT INTO comment_replies (user_fb_id, page_id, post_id, comment_id, comment_text, comment_from, comment_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'other', 'already_replied', ?)"
              ).bind(fbId, page.page_id, postId, comment.id, comment.message.slice(0, 500), comment.from?.name || "", new Date().toISOString()).run();
              continue;
            }
          } catch {
            // Non-critical: if check fails, proceed with caution (DB check already passed)
          }

          try {
            // Classify comment — sticker/image skip AI, treat as greeting
            const isStickerOrImage = comment.message === "[sticker]";
            const postMessage = (post as any).message || "";
            const classification = isStickerOrImage
              ? { type: "greeting" as CommentType, confidence: 1 }
              : await classifyComment(comment.message, provider, apiKey, model, endpoint, postMessage);

            // Handle spam: hide + log
            if (classification.type === "spam") {
              await hideComment(comment.id, pageToken);
              await env.DB.prepare(
                "INSERT INTO comment_replies (user_fb_id, page_id, post_id, comment_id, comment_text, comment_from, comment_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'spam', 'hidden', ?)"
              ).bind(fbId, page.page_id, postId, comment.id, comment.message.slice(0, 500), comment.from?.name || "", new Date().toISOString()).run();

              await createNotification(env.DB, fbId, {
                page_id: page.page_id, type: "auto_reply", priority: "normal",
                title: "🚫 ซ่อน spam comment",
                detail: comment.message.slice(0, 100),
                link: `?page=${page.page_id}&tab=autoReply`,
              });
              continue;
            }

            // Skip greeting if user opted out
            if (skipGreeting && classification.type === "greeting") {
              await env.DB.prepare(
                "INSERT INTO comment_replies (user_fb_id, page_id, post_id, comment_id, comment_text, comment_from, comment_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', ?)"
              ).bind(fbId, page.page_id, postId, comment.id, comment.message.slice(0, 500), comment.from?.name || "", classification.type, new Date().toISOString()).run();
              continue;
            }

            // Rate cap — stop after MAX_REPLIES_PER_RUN replies per page per cron
            if (repliesThisRun >= MAX_REPLIES_PER_RUN) break;

            // Check reply mode before generating
            if (replyMode === "question_only" && classification.type !== "question" && classification.type !== "disagree") {
              // Log as skipped but don't reply
              await env.DB.prepare(
                "INSERT INTO comment_replies (user_fb_id, page_id, post_id, comment_id, comment_text, comment_from, comment_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', ?)"
              ).bind(fbId, page.page_id, postId, comment.id, comment.message.slice(0, 500), comment.from?.name || "", classification.type, new Date().toISOString()).run();
              continue;
            }
            if (replyMode === "random" && Math.random() > 0.7) {
              // 30% chance to skip (reply 60-80%)
              await env.DB.prepare(
                "INSERT INTO comment_replies (user_fb_id, page_id, post_id, comment_id, comment_text, comment_from, comment_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', ?)"
              ).bind(fbId, page.page_id, postId, comment.id, comment.message.slice(0, 500), comment.from?.name || "", classification.type, new Date().toISOString()).run();
              continue;
            }

            // Generate reply
            const replyText = await generateReply(comment.message, classification.type, provider, apiKey, model, endpoint, postMessage, replyTone, customToneText);
            if (!replyText) continue;

            // Like comment first (human-like: read → like → pause → reply)
            await likeComment(comment.id, pageToken);

            // Delay 5-10 seconds between replies (human-like pacing)
            await sleep(5000 + Math.random() * 5000);

            // Post reply
            const result = await replyToComment(comment.id, replyText, pageToken);

            // Save to DB immediately before doing anything else
            await env.DB.prepare(
              "INSERT INTO comment_replies (user_fb_id, page_id, post_id, comment_id, comment_text, comment_from, comment_type, reply_text, reply_id, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(
              fbId, page.page_id, postId, comment.id,
              comment.message.slice(0, 500), comment.from?.name || "",
              classification.type, replyText, result.id || null,
              result.ok ? "replied" : "failed", result.error || null,
              new Date().toISOString(),
            ).run();

            // Verify reply appeared on Facebook before continuing
            if (result.ok) {
              await sleep(3000 + Math.random() * 2000);
              try {
                const verifyRes = await fetch(`https://graph.facebook.com/v25.0/${comment.id}/comments?fields=from,message&limit=10&access_token=${pageToken}`);
                const verifyData = await verifyRes.json() as any;
                const confirmed = (verifyData.data || []).some((r: any) => r.from?.id === page.page_id);
                if (!confirmed) {
                  // Reply not confirmed — update status
                  await env.DB.prepare("UPDATE comment_replies SET status = 'unconfirmed' WHERE comment_id = ? AND user_fb_id = ?").bind(comment.id, fbId).run();
                }
              } catch {}
            }

            // Track reply count for rate cap
            if (result.ok) repliesThisRun++;

            if (result.ok) {
              await createNotification(env.DB, fbId, {
                page_id: page.page_id, type: "auto_reply", priority: "important",
                title: `💬 ตอบ comment [${classification.type}]`,
                detail: replyText.slice(0, 100),
                link: `?page=${page.page_id}&tab=autoReply`,
                source_id: postId,
              });
            }
          } catch (e: any) {
            await createNotification(env.DB, fbId, { page_id: page.page_id, type: "error", priority: "normal", title: "❌ Reply error", detail: `${comment.id}: ${e.message}`.slice(0, 200) }).catch(() => {});
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
      "SELECT enabled, reply_mode, reply_tone, skip_greeting, custom_tone FROM auto_reply_settings WHERE user_fb_id = ? AND page_id = ?"
    ).bind(session.fb_id, pageId).first<{ enabled: number; reply_mode: string; reply_tone: string; skip_greeting: number; custom_tone: string }>();
    return c.json({ page_id: pageId, enabled: row?.enabled === 1, reply_mode: row?.reply_mode || "all", reply_tone: row?.reply_tone || "formal", skip_greeting: row?.skip_greeting === 1, custom_tone: row?.custom_tone || "" });
  }

  // All pages settings
  const { results } = await c.env.DB.prepare(
    "SELECT ars.page_id, ars.enabled, ars.reply_mode, ars.reply_tone, ars.skip_greeting, up.page_name FROM auto_reply_settings ars LEFT JOIN user_pages up ON ars.page_id = up.page_id AND ars.user_fb_id = up.user_fb_id WHERE ars.user_fb_id = ?"
  ).bind(session.fb_id).all();
  return c.json({ pages: results });
});

// POST /api/auto-reply/settings
autoReply.post("/auto-reply/settings", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { enabled, page_id, reply_mode, reply_tone, skip_greeting, custom_tone } = await c.req.json() as { enabled: boolean; page_id: string; reply_mode?: string; reply_tone?: string; skip_greeting?: boolean; custom_tone?: string };
  if (!page_id) return c.json({ error: "page_id required" }, 400);

  const validModes = ["all", "random", "question_only", "off"];
  const mode = reply_mode && validModes.includes(reply_mode) ? reply_mode : "all";
  const validTones = ["formal", "casual", "custom"];
  const tone = reply_tone && validTones.includes(reply_tone) ? reply_tone : "formal";
  const customToneText = (custom_tone || "").slice(0, 200); // limit custom tone length

  // Verify user owns this page
  const page = await c.env.DB.prepare(
    "SELECT page_id FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(session.fb_id, page_id).first();
  if (!page) return c.json({ error: "Page not found" }, 400);

  await c.env.DB.prepare(
    "INSERT INTO auto_reply_settings (user_fb_id, page_id, enabled, reply_mode, reply_tone, skip_greeting, custom_tone) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_fb_id, page_id) DO UPDATE SET enabled = excluded.enabled, reply_mode = excluded.reply_mode, reply_tone = excluded.reply_tone, skip_greeting = excluded.skip_greeting, custom_tone = excluded.custom_tone"
  ).bind(session.fb_id, page_id, enabled ? 1 : 0, mode, tone, skip_greeting ? 1 : 0, customToneText).run();

  return c.json({ ok: true, page_id, enabled, reply_mode: mode, reply_tone: tone, skip_greeting: !!skip_greeting, custom_tone: customToneText });
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
        "SELECT cr.*, p.message as post_message, p.created_at as post_created_at FROM comment_replies cr LEFT JOIN posts p ON cr.post_id = p.fb_post_id AND cr.user_fb_id = p.user_fb_id WHERE cr.user_fb_id = ? AND date(cr.created_at) = ? ORDER BY cr.created_at DESC LIMIT ?"
      ).bind(session.fb_id, date, limit).all()
    : await c.env.DB.prepare(
        "SELECT cr.*, p.message as post_message, p.created_at as post_created_at FROM comment_replies cr LEFT JOIN posts p ON cr.post_id = p.fb_post_id AND cr.user_fb_id = p.user_fb_id WHERE cr.user_fb_id = ? ORDER BY cr.created_at DESC LIMIT ?"
      ).bind(session.fb_id, limit).all();

  return c.json({ replies: results, total: results.length });
});

export default autoReply;
