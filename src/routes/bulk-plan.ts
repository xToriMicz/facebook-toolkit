import { Hono } from "hono";
import type { Env } from "../helpers";
import { getSessionFromReq, decryptToken } from "../helpers";
import { callAI } from "../ai-providers";
import { createNotification } from "./notifications";

const bulkPlan = new Hono<{ Bindings: Env }>();

const MAX_ITEMS_PER_PLAN = 100;
const MAX_ACTIVE_PLANS = 3;
const GENERATE_AHEAD_MS = 1800000; // 30 minutes — generate ล่วงหน้า 30 นาทีก่อนโพส
const MAX_GENERATE_PER_TICK = 2; // Free plan safe (30s timeout)

// ── API Routes ──

// GET /api/bulk-plans — list plans
bulkPlan.get("/bulk-plans", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM bulk_plans WHERE user_fb_id = ? ORDER BY created_at DESC"
  ).bind(session.fb_id).all();
  return c.json({ plans: results });
});

// POST /api/bulk-plans — create plan + items
bulkPlan.post("/bulk-plans", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const body = await c.req.json() as any;
  const { page_id, name, keywords, tone, post_type, date_start, date_end, time_start, time_end, frequency, freq_value } = body;

  if (!page_id || !keywords?.length || !date_start || !date_end) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  // Check active plans limit
  const { results: activePlans } = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM bulk_plans WHERE user_fb_id = ? AND status = 'active'"
  ).bind(session.fb_id).all();
  if (((activePlans[0] as any)?.count || 0) >= MAX_ACTIVE_PLANS) {
    return c.json({ error: `Max ${MAX_ACTIVE_PLANS} active plans allowed` }, 400);
  }

  // Calculate schedule slots
  const slots = calculateSlots(date_start, date_end, time_start || "08:00", time_end || "20:00", frequency || "1perday", freq_value || 1);

  if (slots.length > MAX_ITEMS_PER_PLAN) {
    return c.json({ error: `Max ${MAX_ITEMS_PER_PLAN} items per plan (got ${slots.length})` }, 400);
  }

  // Expand keywords to fill slots
  const angles = ["มุมมองใหม่", "เจาะลึก", "เปรียบเทียบ", "อัพเดตล่าสุด", "สรุปสั้น", "เทรนด์", "ข้อดีข้อเสีย", "คำแนะนำ"];
  const items: { keyword: string; angle: string | null; scheduled_at: string }[] = [];
  for (let i = 0; i < slots.length; i++) {
    const kwIndex = i % keywords.length;
    const angle = i >= keywords.length ? angles[(i - keywords.length) % angles.length] : null;
    items.push({ keyword: keywords[kwIndex], angle, scheduled_at: slots[i] });
  }

  // Create plan
  const planResult = await c.env.DB.prepare(
    "INSERT INTO bulk_plans (user_fb_id, page_id, name, tone, post_type, date_start, date_end, time_start, time_end, frequency, freq_value, total_items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"
  ).bind(
    session.fb_id, page_id, name || "แผนโพส", tone || "general", post_type || "text",
    date_start, date_end, time_start || "08:00", time_end || "20:00",
    frequency || "1perday", freq_value || 1, items.length
  ).first<{ id: number }>();

  if (!planResult) return c.json({ error: "Failed to create plan" }, 500);
  const planId = planResult.id;

  // Create items
  for (const item of items) {
    await c.env.DB.prepare(
      "INSERT INTO bulk_plan_items (plan_id, user_fb_id, page_id, keyword, angle, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(planId, session.fb_id, page_id, item.keyword, item.angle, item.scheduled_at).run();
  }

  return c.json({ ok: true, plan_id: planId, total_items: items.length });
});

// GET /api/bulk-plans/:id/items — list items for a plan
bulkPlan.get("/bulk-plans/:id/items", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const planId = c.req.param("id");

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM bulk_plan_items WHERE plan_id = ? AND user_fb_id = ? ORDER BY scheduled_at ASC"
  ).bind(planId, session.fb_id).all();
  return c.json({ items: results });
});

// PATCH /api/bulk-plans/:id — pause/resume/delete plan
bulkPlan.patch("/bulk-plans/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const planId = c.req.param("id");
  const { status } = await c.req.json() as { status: string };

  if (!["active", "paused", "cancelled"].includes(status)) {
    return c.json({ error: "Invalid status" }, 400);
  }

  await c.env.DB.prepare("UPDATE bulk_plans SET status = ? WHERE id = ? AND user_fb_id = ?")
    .bind(status, planId, session.fb_id).run();
  return c.json({ ok: true });
});

// PATCH /api/bulk-plan-items/:id — edit item
bulkPlan.patch("/bulk-plan-items/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const itemId = c.req.param("id");
  const body = await c.req.json() as any;

  const updates: string[] = [];
  const values: any[] = [];

  if (body.keyword !== undefined) { updates.push("keyword = ?"); values.push(body.keyword); }
  if (body.message !== undefined) { updates.push("message = ?"); values.push(body.message); }
  if (body.scheduled_at !== undefined) { updates.push("scheduled_at = ?"); values.push(body.scheduled_at); }
  if (body.status !== undefined && ["pending", "cancelled"].includes(body.status)) {
    updates.push("status = ?"); values.push(body.status);
  }

  if (!updates.length) return c.json({ ok: true });

  values.push(itemId, session.fb_id);
  await c.env.DB.prepare(
    `UPDATE bulk_plan_items SET ${updates.join(", ")} WHERE id = ? AND user_fb_id = ? AND status NOT IN ('posting', 'posted')`
  ).bind(...values).run();
  return c.json({ ok: true });
});

// DELETE /api/bulk-plan-items/:id — delete item
bulkPlan.delete("/bulk-plan-items/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const itemId = c.req.param("id");

  await c.env.DB.prepare(
    "DELETE FROM bulk_plan_items WHERE id = ? AND user_fb_id = ? AND status NOT IN ('posting', 'posted')"
  ).bind(itemId, session.fb_id).run();
  return c.json({ ok: true });
});

// ── Cron: Generate content (2h ahead, 1-2 items per tick) ──

export async function processBulkGenerate(env: Env) {
  const now = Date.now();
  const aheadTime = new Date(now + GENERATE_AHEAD_MS).toISOString();

  // Get pending items that need generating (scheduled within 2h)
  const { results: items } = await env.DB.prepare(
    `SELECT bpi.*, bp.tone, bp.post_type FROM bulk_plan_items bpi
     JOIN bulk_plans bp ON bpi.plan_id = bp.id
     WHERE bpi.status = 'pending' AND bpi.scheduled_at <= ? AND bp.status = 'active'
     ORDER BY bpi.scheduled_at ASC LIMIT ?`
  ).bind(aheadTime, MAX_GENERATE_PER_TICK).all();

  if (!items.length) return;

  for (const item of items as any[]) {
    // Optimistic lock: pending → generating
    const lockResult = await env.DB.prepare(
      "UPDATE bulk_plan_items SET status = 'generating' WHERE id = ? AND status = 'pending'"
    ).bind(item.id).run();
    if (!lockResult.meta.changes) continue; // already taken

    // Get AI settings
    const aiSettings = await env.DB.prepare(
      "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
    ).bind(item.user_fb_id).first<any>();

    const provider = aiSettings?.provider || "anthropic";
    const apiKey = aiSettings?.api_key || env.ANTHROPIC_API_KEY;
    const model = aiSettings?.model || "claude-haiku-4-5-20251001";
    const endpoint = aiSettings?.endpoint_url;

    if (!apiKey) {
      await env.DB.prepare("UPDATE bulk_plan_items SET status = 'failed', error_message = 'No API key' WHERE id = ?").bind(item.id).run();
      continue;
    }

    try {
      let message = "";
      const topicExtra = item.angle ? ` เขียนในมุม: ${item.angle} ห้ามซ้ำกับโพสก่อนหน้า` : "";

      // Generate text
      if (item.post_type === "text" || item.post_type === "text_image") {
        const result = await callAI(provider, apiKey, model,
          `เขียนโพส Facebook เรื่อง "${item.keyword}"${topicExtra}\nTone: ${item.tone || "general"}\nความยาว: ปานกลาง\nห้าม markdown ใช้ emoji ได้ เขียนข้อความโพสเท่านั้น`,
          endpoint
        );
        message = result.text || "";
      }

      // Generate image
      let imageUrl: string | null = null;
      if (item.post_type === "text_image" || item.post_type === "image") {
        try {
          const encKey = env.TOKEN_ENCRYPTION_KEY || env.FB_APP_SECRET;
          const userPage = await env.DB.prepare("SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?")
            .bind(item.user_fb_id, item.page_id).first<any>();
          // Use AI image generation if available
          // For now skip image if no dedicated endpoint
        } catch { /* image generation is optional */ }
      }

      await env.DB.prepare(
        "UPDATE bulk_plan_items SET status = 'generated', message = ?, image_url = ?, generated_at = ? WHERE id = ?"
      ).bind(message, imageUrl, new Date().toISOString(), item.id).run();

      // Update plan counters
      await env.DB.prepare(
        "UPDATE bulk_plans SET generated = generated + 1 WHERE id = ?"
      ).bind(item.plan_id).run();

    } catch (e: any) {
      await env.DB.prepare(
        "UPDATE bulk_plan_items SET status = 'failed', error_message = ? WHERE id = ?"
      ).bind((e.message || "Unknown error").slice(0, 500), item.id).run();
    }
  }
}

// ── Cron: Post generated content (when scheduled_at <= now) ──

export async function processBulkPost(env: Env) {
  const now = new Date().toISOString();
  const encKey = env.TOKEN_ENCRYPTION_KEY || env.FB_APP_SECRET;

  // Get items ready to post
  const { results: items } = await env.DB.prepare(
    `SELECT bpi.*, bp.status as plan_status FROM bulk_plan_items bpi
     JOIN bulk_plans bp ON bpi.plan_id = bp.id
     WHERE bpi.status = 'generated' AND bpi.scheduled_at <= ? AND bp.status = 'active'
     ORDER BY bpi.scheduled_at ASC LIMIT 3`
  ).bind(now).all();

  for (const item of items as any[]) {
    // Optimistic lock
    const lockResult = await env.DB.prepare(
      "UPDATE bulk_plan_items SET status = 'posting' WHERE id = ? AND status = 'generated'"
    ).bind(item.id).run();
    if (!lockResult.meta.changes) continue;

    const userPage = await env.DB.prepare(
      "SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
    ).bind(item.user_fb_id, item.page_id).first<any>();

    if (!userPage) {
      await env.DB.prepare("UPDATE bulk_plan_items SET status = 'failed', error_message = 'No page token' WHERE id = ?").bind(item.id).run();
      continue;
    }

    const pageToken = userPage.page_token.startsWith("enc:")
      ? await (async () => { try { return decryptToken(userPage.page_token, encKey); } catch { return null; } })()
      : userPage.page_token;

    if (!pageToken) {
      await env.DB.prepare("UPDATE bulk_plan_items SET status = 'failed', error_message = 'Invalid token' WHERE id = ?").bind(item.id).run();
      continue;
    }

    try {
      let result: any;
      if (item.image_url) {
        const res = await fetch(`https://graph.facebook.com/v25.0/${item.page_id}/photos`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: item.image_url, message: item.message, access_token: pageToken }),
        });
        result = await res.json();
      } else {
        const res = await fetch(`https://graph.facebook.com/v25.0/${item.page_id}/feed`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: item.message, access_token: pageToken }),
        });
        result = await res.json();
      }

      if (result.error) {
        await env.DB.prepare("UPDATE bulk_plan_items SET status = 'failed', error_message = ? WHERE id = ?")
          .bind(result.error.message?.slice(0, 500), item.id).run();
        await createNotification(env.DB, item.user_fb_id, {
          page_id: item.page_id, type: "error", priority: "urgent",
          title: "❌ Bulk โพสล้มเหลว", detail: result.error.message?.slice(0, 100),
          link: `?page=${item.page_id}&tab=schedule`,
        });
      } else {
        const fbPostId = result.id || result.post_id || null;
        await env.DB.prepare("UPDATE bulk_plan_items SET status = 'posted', fb_post_id = ?, posted_at = ? WHERE id = ?")
          .bind(fbPostId, new Date().toISOString(), item.id).run();
        await env.DB.prepare("UPDATE bulk_plans SET posted = posted + 1 WHERE id = ?").bind(item.plan_id).run();

        // Insert to posts table
        try {
          await env.DB.prepare(
            "INSERT INTO posts (message, image_url, fb_post_id, page_id, user_fb_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'posted', ?)"
          ).bind(item.message, item.image_url, fbPostId, item.page_id, item.user_fb_id, new Date().toISOString()).run();
        } catch { /* non-critical */ }

        await createNotification(env.DB, item.user_fb_id, {
          page_id: item.page_id, type: "scheduled", priority: "normal",
          title: "✅ Bulk โพสสำเร็จ", detail: (item.message || "").slice(0, 100),
          link: `?page=${item.page_id}&tab=activityLog`,
        });
      }
    } catch (e: any) {
      await env.DB.prepare("UPDATE bulk_plan_items SET status = 'failed', error_message = ? WHERE id = ?")
        .bind((e.message || "").slice(0, 500), item.id).run();
    }
  }
}

// ── Helper: Calculate schedule slots ──

function calculateSlots(dateStart: string, dateEnd: string, timeStart: string, timeEnd: string, frequency: string, freqValue: number): string[] {
  const slots: string[] = [];
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  const [startH] = timeStart.split(":").map(Number);
  const [endH] = timeEnd.split(":").map(Number);
  const hoursRange = endH - startH;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];

    if (frequency === "1perday") {
      const hour = startH + Math.floor(Math.random() * hoursRange);
      const min = Math.floor(Math.random() * 4) * 15; // 0, 15, 30, 45
      slots.push(`${dateStr}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`);
    } else if (frequency === "many") {
      for (let p = 0; p < freqValue; p++) {
        const hour = startH + Math.floor((hoursRange / freqValue) * p + Math.random() * (hoursRange / freqValue));
        const min = Math.floor(Math.random() * 4) * 15;
        slots.push(`${dateStr}T${String(Math.min(hour, endH - 1)).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`);
      }
    } else if (frequency === "interval") {
      for (let h = startH; h < endH; h += freqValue) {
        const min = Math.floor(Math.random() * 4) * 15;
        slots.push(`${dateStr}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`);
      }
    } else {
      // auto: 1 per day
      const hour = startH + Math.floor(Math.random() * hoursRange);
      slots.push(`${dateStr}T${String(hour).padStart(2, "0")}:00:00`);
    }
  }

  return slots.sort();
}

export default bulkPlan;
