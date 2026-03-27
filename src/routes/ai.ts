import { Hono } from "hono";
import { Env, getSessionFromReq, rateLimit, kvCache, sanitize } from "../helpers";
import { callAI } from "../ai-providers";

const ai = new Hono<{ Bindings: Env }>();

// GET /api/ai-settings
ai.get("/ai-settings", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const row = await c.env.DB.prepare(
    "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
  ).bind(session.fb_id).first<{ provider: string; model: string; api_key: string; endpoint_url: string }>();
  if (!row) return c.json({ configured: false });
  return c.json({
    configured: true, provider: row.provider, model: row.model,
    api_key_preview: row.api_key ? row.api_key.slice(0, 8) + "****" : null,
    endpoint_url: row.endpoint_url,
  });
});

// POST /api/ai-settings
ai.post("/ai-settings", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { provider, model, api_key, endpoint_url } = await c.req.json() as any;
  if (!provider) return c.json({ error: "provider required" }, 400);
  const defaults: Record<string, { model: string; endpoint: string }> = {
    anthropic: { model: "claude-haiku-4-5-20251001", endpoint: "https://api.anthropic.com/v1/messages" },
    openai: { model: "gpt-4o-mini", endpoint: "https://api.openai.com/v1/chat/completions" },
    google: { model: "gemini-2.0-flash", endpoint: "https://generativelanguage.googleapis.com/v1beta/models" },
  };
  const def = defaults[provider];
  await c.env.DB.prepare(
    `INSERT INTO user_ai_settings (user_fb_id, provider, model, api_key, endpoint_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_fb_id) DO UPDATE SET
     provider=excluded.provider, model=excluded.model, api_key=excluded.api_key, endpoint_url=excluded.endpoint_url`
  ).bind(session.fb_id, provider, model || def?.model || "", api_key || "", endpoint_url || def?.endpoint || "", new Date().toISOString()).run();
  return c.json({ ok: true });
});

// POST /api/ai-settings/test
ai.post("/ai-settings/test", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { provider, api_key, model, endpoint } = await c.req.json();
  if (!provider || !api_key || !model) return c.json({ error: "provider, api_key, model required" }, 400);
  try {
    const result = await callAI(provider, api_key, model, "Say hello in Thai, one sentence only.", endpoint);
    return c.json({ ok: true, provider, model: result.model, response: result.text, usage: result.usage });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 400);
  }
});

// POST /api/ai-write
ai.post("/ai-write", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  if (await rateLimit(c.env.KV, `ai:${session.fb_id}`, 100)) {
    return c.json({ error: "Rate limit: max 100 AI writes/hour" }, 429);
  }

  const { topic, tone, format } = await c.req.json() as { topic?: string; tone?: string; format?: string };
  if (!topic) return c.json({ error: "topic required" }, 400);
  if (topic.length > 2000) return c.json({ error: "topic too long (max 2000)" }, 400);

  const toneConfig: Record<string, { desc: string; wordCount: string }> = {
    "general": { desc: "เขียนอิสระ น่าสนใจ อ่านง่าย", wordCount: "150-250 คำ" },
    "professional": { desc: "ให้ความรู้ลึก เริ่มด้วย hook แรง 2-3 บรรทัดที่ทำให้คนต้องกด ดูเพิ่มเติม แบ่งเป็นหัวข้อย่อย ใช้ emoji เป็น bullet มีสถิติ/fact ปิดด้วย takeaway ที่ปฏิบัติได้ + ถามคำถามให้คนคอมเมนต์", wordCount: "300-500 คำ" },
  };
  const config = toneConfig[tone || "general"] || toneConfig["general"];

  const systemPrompt = `คุณเป็น Social Media Content Writer มืออาชีพ เขียนเป็นภาษาไทย
กฎสำคัญ:
- เขียน caption สำหรับโพส Facebook
- โทน: ${config.desc}
- ความยาว: ${config.wordCount} (สำคัญมาก! ต้องเขียนให้ครบตามจำนวนคำที่กำหนด ห้ามสั้นกว่านี้)
- ใส่อีโมจิตามความเหมาะสม
- แนะนำ hashtag ภาษาไทย 3-5 อัน
- ตอบเป็น JSON: {"text":"caption ที่เขียน","hashtags":["#tag1","#tag2"]}
- ตอบ JSON เท่านั้น ไม่มีข้อความอื่น
- ย้ำอีกครั้ง: เนื้อหาต้องยาว ${config.wordCount} จริงๆ นับคำให้ครบ`;

  const aiSettings = await c.env.DB.prepare(
    "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
  ).bind(session.fb_id).first<{ provider: string; model: string; api_key: string; endpoint_url: string }>();

  const provider = aiSettings?.provider || "anthropic";
  const apiKey = aiSettings?.api_key || c.env.ANTHROPIC_API_KEY;
  const model = aiSettings?.model || "claude-haiku-4-5-20251001";
  const endpoint = aiSettings?.endpoint_url || "https://api.anthropic.com/v1/messages";
  if (!apiKey) return c.json({ error: "No API key configured. Go to Settings > AI to add one." }, 400);

  const maxTokens = tone === "professional" ? 4096 : 2048;
  const userMsg = `เขียน caption Facebook เกี่ยวกับ: ${topic}`;

  try {
    let responseText = "";
    if (provider === "openai") {
      const res = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }] }) });
      const data = await res.json() as any;
      if (data.error) return c.json({ error: data.error.message }, 500);
      responseText = data.choices?.[0]?.message?.content || "";
    } else if (provider === "google") {
      const res = await fetch(`${endpoint}/${model}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMsg}` }] }], generationConfig: { maxOutputTokens: maxTokens } }) });
      const data = await res.json() as any;
      if (data.error) return c.json({ error: data.error.message }, 500);
      responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      const res = await fetch(endpoint, { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: userMsg }], system: systemPrompt }) });
      const data = await res.json() as any;
      if (data.error) return c.json({ error: data.error.message }, 500);
      responseText = data.content?.[0]?.text || "";
    }

    let cleaned = responseText.trim();
    if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
    // Try to extract JSON from response (AI sometimes wraps in extra text)
    const jsonMatch = cleaned.match(/\{[\s\S]*"text"\s*:\s*"[\s\S]*"\s*[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : cleaned;
    try {
      const parsed = JSON.parse(jsonStr);
      return c.json({ ok: true, text: parsed.text || "", hashtags: parsed.hashtags || [], provider });
    } catch {
      // If JSON parse fails, use the raw text but strip any JSON artifacts
      const fallback = cleaned.replace(/^\s*\{?\s*"text"\s*:\s*"?/, "").replace(/"?\s*,?\s*"hashtags".*$/, "").replace(/"\s*\}\s*$/, "").trim();
      return c.json({ ok: true, text: fallback || cleaned, hashtags: [], provider });
    }
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// GET /api/templates — per-user + shared (user_fb_id IS NULL)
ai.get("/templates", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const category = c.req.query("category") || "all";
  let query = "SELECT * FROM content_templates WHERE (user_fb_id = ? OR user_fb_id IS NULL)";
  const params: (string | null)[] = [session.fb_id];
  if (category !== "all") { query += " AND category = ?"; params.push(category); }
  query += " ORDER BY created_at DESC";
  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ templates: results, total: results.length });
});

// POST /api/templates
ai.post("/templates", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  const { title, template_text, category } = await c.req.json();
  if (!title || !template_text) return c.json({ error: "title and template_text required" }, 400);
  const cat = sanitize(category || "ทั่วไป");
  const { meta } = await c.env.DB.prepare(
    "INSERT INTO content_templates (title, template_text, category, user_fb_id) VALUES (?, ?, ?, ?)"
  ).bind(sanitize(title), sanitize(template_text), cat, session.fb_id).run();
  return c.json({ ok: true, id: meta.last_row_id }, 201);
});

// DELETE /api/templates/:id
ai.delete("/templates/:id", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  await c.env.DB.prepare("DELETE FROM content_templates WHERE id = ? AND (user_fb_id = ? OR user_fb_id IS NULL)").bind(c.req.param("id"), session.fb_id).run();
  await c.env.KV.delete("tpl:all");
  return c.json({ ok: true });
});

export default ai;
