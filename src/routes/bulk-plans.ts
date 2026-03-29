import { Hono } from "hono";
import type { Env } from "../helpers";
import { getSessionFromReq } from "../helpers";

const bulkPlans = new Hono<{ Bindings: Env }>();

// GET /api/bulk-plans — list plans
bulkPlans.get("/bulk-plans", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const pageId = c.req.query("page_id");
  const { results } = pageId
    ? await c.env.DB.prepare(
        "SELECT * FROM bulk_plans WHERE user_fb_id = ? AND page_id = ? ORDER BY created_at DESC"
      ).bind(session.fb_id, pageId).all()
    : await c.env.DB.prepare(
        "SELECT * FROM bulk_plans WHERE user_fb_id = ? ORDER BY created_at DESC"
      ).bind(session.fb_id).all();

  return c.json({ plans: results });
});

// POST /api/bulk-plans — create plan + items
bulkPlans.post("/bulk-plans", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const body = await c.req.json() as any;
  const { page_id, name, tone, post_type, date_start, date_end, time_start, time_end, frequency, freq_value, items } = body;

  if (!page_id || !date_start || !date_end || !items?.length) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  // Create plan
  const planResult = await c.env.DB.prepare(
    "INSERT INTO bulk_plans (user_fb_id, page_id, name, tone, post_type, date_start, date_end, time_start, time_end, frequency, freq_value, total_items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    session.fb_id, page_id, name || null, tone || "general", post_type || "text",
    date_start, date_end, time_start || "08:00", time_end || "20:00",
    frequency || "auto", freq_value || 1, items.length
  ).run();

  const planId = planResult.meta?.last_row_id;
  if (!planId) return c.json({ error: "Failed to create plan" }, 500);

  // Create items
  for (const item of items) {
    await c.env.DB.prepare(
      "INSERT INTO bulk_plan_items (plan_id, user_fb_id, page_id, keyword, angle, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(planId, session.fb_id, page_id, item.keyword, item.angle || null, item.scheduled_at).run();
  }

  return c.json({ ok: true, plan_id: planId, items_created: items.length });
});

// GET /api/bulk-plans/:id — get plan + items
bulkPlans.get("/bulk-plans/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const id = c.req.param("id");
  const plan = await c.env.DB.prepare(
    "SELECT * FROM bulk_plans WHERE id = ? AND user_fb_id = ?"
  ).bind(id, session.fb_id).first();

  if (!plan) return c.json({ error: "Plan not found" }, 404);

  const { results: items } = await c.env.DB.prepare(
    "SELECT * FROM bulk_plan_items WHERE plan_id = ? ORDER BY scheduled_at ASC"
  ).bind(id).all();

  return c.json({ plan, items });
});

// PUT /api/bulk-plans/:id — update plan status (pause/resume)
bulkPlans.put("/bulk-plans/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const id = c.req.param("id");
  const body = await c.req.json() as any;

  if (body.status) {
    await c.env.DB.prepare(
      "UPDATE bulk_plans SET status = ? WHERE id = ? AND user_fb_id = ?"
    ).bind(body.status, id, session.fb_id).run();
  }

  return c.json({ ok: true });
});

// PUT /api/bulk-plans/items/:id — update single item
bulkPlans.put("/bulk-plans/items/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const id = c.req.param("id");
  const body = await c.req.json() as any;
  const updates: string[] = [];
  const values: any[] = [];

  const fields = ["keyword", "angle", "scheduled_at", "message", "image_url"];
  for (const f of fields) {
    if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); }
  }
  // Allow resetting status to pending (for re-generate)
  if (body.status === "pending") { updates.push("status = 'pending'"); updates.push("generated_at = NULL"); updates.push("message = NULL"); updates.push("image_url = NULL"); }

  if (!updates.length) return c.json({ ok: true });

  values.push(id, session.fb_id);
  await c.env.DB.prepare(
    `UPDATE bulk_plan_items SET ${updates.join(", ")} WHERE id = ? AND user_fb_id = ?`
  ).bind(...values).run();

  return c.json({ ok: true });
});

// DELETE /api/bulk-plans/items/:id — delete item
bulkPlans.delete("/bulk-plans/items/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const id = c.req.param("id");
  await c.env.DB.prepare(
    "DELETE FROM bulk_plan_items WHERE id = ? AND user_fb_id = ? AND status NOT IN ('posted', 'posting')"
  ).bind(id, session.fb_id).run();

  return c.json({ ok: true });
});

export default bulkPlans;
