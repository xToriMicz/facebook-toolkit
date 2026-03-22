import { Hono } from "hono";
import { Env, getSessionFromReq, sanitize } from "../helpers";

const tickets = new Hono<{ Bindings: Env }>();

// POST /api/tickets — create ticket + auto-create GitHub Issue
tickets.post("/tickets", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { type, title, description, screenshot_url } = await c.req.json() as any;
  if (!title) return c.json({ error: "title required" }, 400);

  const ticketType = ["bug", "feature", "question"].includes(type) ? type : "bug";
  const safeTitle = sanitize(title).slice(0, 200);
  const safeDesc = description ? sanitize(description).slice(0, 2000) : "";

  // Save to D1
  const { meta } = await c.env.DB.prepare(
    "INSERT INTO tickets (user_fb_id, type, title, description, screenshot_url) VALUES (?, ?, ?, ?, ?)"
  ).bind(session.fb_id, ticketType, safeTitle, safeDesc, screenshot_url || null).run();

  const ticketId = meta.last_row_id;

  // Auto-create GitHub Issue in 072-oracle repo
  let issueUrl: string | null = null;
  const ghToken = await c.env.KV.get("github_token");
  if (ghToken) {
    try {
      const issueBody = [
        `**Type:** ${ticketType}`,
        `**From:** ${session.name || session.fb_id}`,
        `**Ticket ID:** #${ticketId}`,
        "",
        safeDesc || "(no description)",
        screenshot_url ? `\n**Screenshot:** ${screenshot_url}` : "",
        "",
        "---",
        "*Auto-created from Facebook Toolkit*",
      ].join("\n");

      const labels = [`ticket:${ticketType}`];

      const res = await fetch("https://api.github.com/repos/xToriMicz/072-oracle/issues", {
        method: "POST",
        headers: {
          Authorization: `token ${ghToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "facebook-toolkit",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `[${ticketType.toUpperCase()}] ${safeTitle}`,
          body: issueBody,
          labels,
        }),
      });

      const issueData = await res.json() as any;
      if (issueData.html_url) {
        issueUrl = issueData.html_url;
        await c.env.DB.prepare(
          "UPDATE tickets SET issue_url = ? WHERE id = ?"
        ).bind(issueUrl, ticketId).run();
      }
    } catch (e: any) {
      console.error("GitHub Issue creation failed:", e.message);
    }
  }

  return c.json({ ok: true, id: ticketId, issue_url: issueUrl }, 201);
});

// GET /api/tickets — list user's tickets
tickets.get("/tickets", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM tickets WHERE user_fb_id = ? ORDER BY created_at DESC LIMIT 50"
  ).bind(session.fb_id).all();

  return c.json({ tickets: results, total: results.length });
});

// GET /api/tickets/:id
tickets.get("/tickets/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const ticket = await c.env.DB.prepare(
    "SELECT * FROM tickets WHERE id = ? AND user_fb_id = ?"
  ).bind(c.req.param("id"), session.fb_id).first();

  if (!ticket) return c.json({ error: "Ticket not found" }, 404);
  return c.json({ ticket });
});

export default tickets;
