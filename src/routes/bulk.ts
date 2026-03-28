import { Hono } from "hono";
import type { Env } from "../helpers";
import { getSessionFromReq, rateLimit, sanitize } from "../helpers";
import { callAI } from "../ai-providers";

const bulk = new Hono<{ Bindings: Env }>();

// ── Types ──

interface BulkGenerateRequest {
  keywords: string[];
  type: "text" | "text+image" | "image";
  tone?: "general" | "professional";
  aspect_ratio?: string;
  overlay_text?: boolean;
  schedule: {
    start_date: string;   // ISO 8601 date e.g. "2026-03-28"
    end_date: string;     // ISO 8601 date e.g. "2026-04-05"
    start_time: number;   // Hour 0-23
    end_time: number;     // Hour 0-23
    frequency: "1/day" | "many/day" | "every_x_hr" | "auto";
    posts_per_day?: number;   // for "many/day"
    interval_hours?: number;  // for "every_x_hr"
  };
}

interface GeneratedPost {
  keyword: string;
  message: string;
  hashtags: string[];
  image_url?: string;
  image_prompt?: string;
  scheduled_at: string;
}

// ── Helpers ──

const VALID_ASPECTS = new Set(["1:1", "9:16", "16:9", "4:5", "3:4", "4:3", "2:3", "3:2", "5:4"]);

/** Calculate schedule slots from date range + frequency for N posts */
function calculateSchedule(
  count: number,
  schedule: BulkGenerateRequest["schedule"],
): string[] {
  const start = new Date(`${schedule.start_date}T${String(schedule.start_time).padStart(2, "0")}:00:00`);
  const end = new Date(`${schedule.end_date}T${String(schedule.end_time).padStart(2, "0")}:00:00`);

  if (end <= start) throw new Error("end must be after start");

  const totalMs = end.getTime() - start.getTime();
  const slots: string[] = [];

  switch (schedule.frequency) {
    case "1/day": {
      // 1 post per day, random time within start_time..end_time window
      const current = new Date(start);
      while (slots.length < count && current <= end) {
        const hour = schedule.start_time + Math.floor(
          Math.random() * (schedule.end_time - schedule.start_time)
        );
        const minute = Math.floor(Math.random() * 60);
        const slot = new Date(current);
        slot.setHours(hour, minute, 0, 0);
        slots.push(slot.toISOString());
        current.setDate(current.getDate() + 1);
      }
      break;
    }
    case "many/day": {
      const perDay = schedule.posts_per_day || 3;
      const current = new Date(start);
      const endDate = new Date(end);
      while (slots.length < count && current <= endDate) {
        const windowHours = schedule.end_time - schedule.start_time;
        const gap = windowHours / (perDay + 1);
        for (let i = 1; i <= perDay && slots.length < count; i++) {
          const slot = new Date(current);
          const hour = schedule.start_time + gap * i;
          slot.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
          slots.push(slot.toISOString());
        }
        current.setDate(current.getDate() + 1);
      }
      break;
    }
    case "every_x_hr": {
      const intervalMs = (schedule.interval_hours || 3) * 60 * 60 * 1000;
      const current = new Date(start);
      while (slots.length < count && current <= end) {
        slots.push(current.toISOString());
        current.setTime(current.getTime() + intervalMs);
        // Skip hours outside the daily window
        if (current.getHours() >= schedule.end_time) {
          current.setDate(current.getDate() + 1);
          current.setHours(schedule.start_time, 0, 0, 0);
        }
        if (current.getHours() < schedule.start_time) {
          current.setHours(schedule.start_time, 0, 0, 0);
        }
      }
      break;
    }
    case "auto":
    default: {
      // Evenly distribute across the entire range
      const gap = count > 1 ? totalMs / (count - 1) : 0;
      for (let i = 0; i < count; i++) {
        const slot = new Date(start.getTime() + gap * i);
        // Jitter: add 0-15 minutes random offset
        slot.setMinutes(slot.getMinutes() + Math.floor(Math.random() * 15));
        slots.push(slot.toISOString());
      }
      break;
    }
  }

  return slots.slice(0, count);
}

/** Generate AI text for a keyword (reuses ai-write logic) */
async function generateText(
  keyword: string,
  tone: string,
  provider: string,
  apiKey: string,
  model: string,
  endpoint: string,
): Promise<{ text: string; hashtags: string[] }> {
  const toneConfig: Record<string, { desc: string; wordCount: string }> = {
    general: { desc: "เขียนอิสระ น่าสนใจ อ่านง่าย", wordCount: "150-250 คำ" },
    professional: { desc: "ให้ความรู้เชิงลึกแบบ Facebook viral", wordCount: "300-500 คำ" },
  };
  const config = toneConfig[tone] ?? toneConfig["general"]!;

  const professionalStyle = tone === "professional" ? `
สไตล์การเขียน (สำคัญมาก ต้องทำตามทุกข้อ):
- ประโยคสั้นมาก 1-2 บรรทัดต่อ 1 ความคิด แล้วขึ้นบรรทัดใหม่
- ห้ามเขียนย่อหน้ายาว ต้องตัดบรรทัดบ่อยๆ อ่านง่ายบนมือถือ
- ใช้ . . . (จุดสามจุดมีเว้นวรรค) คั่นระหว่าง section
- ใส่เลขหัวข้อ 1) 2) 3) ... นำแต่ละ section
- 2-3 บรรทัดแรกต้อง hook แรงมาก ทำให้คนต้องกด "ดูเพิ่มเติม"
- ภาษาพูดเป็นกันเอง ไม่ใช่ภาษาเขียนทางการ
- emoji ใช้น้อย แค่จุดสำคัญ ไม่ใช่ทุกบรรทัด
- มีสถิติ/ตัวเลข/fact ให้น่าเชื่อถือ
- จบด้วยคำถามเปิดให้คนคอมเมนต์
- hashtag ภาษาไทย 3-5 อันรวมท้ายโพส` : "";

  const systemPrompt = `คุณเป็น Social Media Content Writer มืออาชีพ เขียนเป็นภาษาไทย
กฎสำคัญ:
- เขียน caption สำหรับโพส Facebook
- โทน: ${config.desc}
- ความยาว: ${config.wordCount} (สำคัญมาก! ต้องเขียนให้ครบตามจำนวนคำที่กำหนด ห้ามสั้นกว่านี้)
- ห้ามใช้ markdown เด็ดขาด (ห้าม ** ห้าม * ห้าม # ห้าม backtick) เพราะ Facebook ไม่รองรับ
- แนะนำ hashtag ภาษาไทย 3-5 อัน
- ตอบเป็น JSON: {"text":"caption ที่เขียน","hashtags":["#tag1","#tag2"]}
- ตอบ JSON เท่านั้น ไม่มีข้อความอื่น
- ย้ำอีกครั้ง: เนื้อหาต้องยาว ${config.wordCount} จริงๆ นับคำให้ครบ ห้ามใช้ markdown${professionalStyle}`;

  const maxTokens = tone === "professional" ? 4096 : 2048;
  const userMsg = `เขียน caption Facebook เกี่ยวกับ: ${keyword}`;

  let responseText = "";
  if (provider === "openai") {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }] }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(data.error.message);
    responseText = data.choices?.[0]?.message?.content || "";
  } else if (provider === "google") {
    const res = await fetch(`${endpoint}/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMsg}` }] }], generationConfig: { maxOutputTokens: maxTokens } }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(data.error.message);
    responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } else {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: userMsg }], system: systemPrompt }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(data.error.message);
    responseText = data.content?.[0]?.text || "";
  }

  let cleaned = responseText.trim();
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();

  function stripMd(t: string): string {
    return t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/```[^`]*```/g, "");
  }

  const jsonMatch = cleaned.match(/\{[\s\S]*"text"\s*:\s*"[\s\S]*"\s*[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : cleaned;
  try {
    const parsed = JSON.parse(jsonStr);
    return { text: stripMd(parsed.text || ""), hashtags: parsed.hashtags || [] };
  } catch {
    const fallback = cleaned.replace(/^\s*\{?\s*"text"\s*:\s*"?/, "").replace(/"?\s*,?\s*"hashtags".*$/, "").replace(/"\s*\}\s*$/, "").trim();
    return { text: fallback || cleaned, hashtags: [] };
  }
}

/** Generate image for a keyword (reuses ai-image logic) */
async function generateImageForKeyword(
  keyword: string,
  aspectRatio: string,
  overlayText: boolean,
  env: Env,
  fbId: string,
): Promise<{ image_url: string; prompt: string }> {
  const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
  const GEMINI_IMAGE_MODEL_PRO = "gemini-3-pro-image-preview";
  const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

  const geminiKey = await env.KV.get(`u:${fbId}:gemini_key`);
  if (!geminiKey) throw new Error("Gemini API key not configured");

  const aiSettings = await env.DB.prepare(
    "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
  ).bind(fbId).first<{ provider: string; model: string; api_key: string; endpoint_url: string }>();

  const provider = aiSettings?.provider || "anthropic";
  const apiKey = aiSettings?.api_key || env.ANTHROPIC_API_KEY;
  const model = aiSettings?.model || "claude-haiku-4-5-20251001";

  // Convert keyword to image prompt
  const promptResult = await callAI(provider, apiKey, model,
    `You are an image prompt engineer for social media posts. Convert the following Thai text into an English image generation prompt (max 300 chars).

Rules:
- Create a photorealistic or high-quality illustration style image (NOT infographic, NOT clip art, NOT flat icons)
- Focus on emotion, atmosphere, and visual storytelling
- Include lighting, color mood, and composition details
- Output ONLY the prompt, nothing else

Text: ${keyword}`,
    aiSettings?.endpoint_url
  );

  let imagePrompt = promptResult.text.trim();

  // Add overlay text if requested
  if (overlayText) {
    const headlineResult = await callAI(provider, apiKey, model,
      `สร้างหัวข้อสั้นๆ ภาษาไทย 3-8 คำ สำหรับวาดบนรูปโซเชียล จากข้อความนี้ ตอบแค่หัวข้อเท่านั้น ไม่ต้องอธิบาย:\n\n${keyword}`,
      aiSettings?.endpoint_url
    );
    const headline = headlineResult.text.trim().replace(/"/g, "");
    imagePrompt += `. Include prominent Thai text overlay on the image that reads: "${headline}". The text should be large, clear, easy to read, with good contrast against the background. Use a modern bold font style.`;
  }

  // Generate via Gemini
  const usePro = overlayText;
  const geminiModel = usePro ? GEMINI_IMAGE_MODEL_PRO : GEMINI_IMAGE_MODEL;
  const url = `${GEMINI_API_BASE}/${geminiModel}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": geminiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio, imageSize: "1K" },
      },
    }),
  });

  const data = await res.json() as any;
  if (data.error) throw new Error(data.error.message || "Gemini API error");

  const part = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
  if (!part?.inlineData?.data) throw new Error("No image in Gemini response");

  // Upload to R2
  const mimeType = part.inlineData.mimeType || "image/png";
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const key = `uploads/ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const binary = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0));
  await env.ASSETS.put(key, binary.buffer, { httpMetadata: { contentType: mimeType } });

  return { image_url: `https://fb.makeloops.xyz/img/${key}`, prompt: imagePrompt };
}

// ── POST /api/bulk/generate ──

bulk.post("/bulk/generate", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  // Rate limit: 10 bulk generates per hour
  if (await rateLimit(c.env.KV, `bulk:${session.fb_id}`, 10)) {
    return c.json({ error: "Rate limit: max 10 bulk generates/hour" }, 429);
  }

  const body = await c.req.json() as BulkGenerateRequest;

  // ── Validate ──
  if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
    return c.json({ error: "keywords array required (1-10)" }, 400);
  }
  if (body.keywords.length > 10) {
    return c.json({ error: "Maximum 10 keywords" }, 400);
  }
  const validTypes = ["text", "text+image", "image"];
  if (!body.type || !validTypes.includes(body.type)) {
    return c.json({ error: "type must be text, text+image, or image" }, 400);
  }
  if (!body.schedule?.start_date || !body.schedule?.end_date) {
    return c.json({ error: "schedule.start_date and schedule.end_date required" }, 400);
  }
  if (body.schedule.start_time == null || body.schedule.end_time == null) {
    return c.json({ error: "schedule.start_time and schedule.end_time required (0-23)" }, 400);
  }

  // Sanitize keywords
  const keywords = body.keywords
    .map((k) => sanitize(k.trim()))
    .filter((k) => k.length > 0 && k.length <= 2000);

  if (keywords.length === 0) {
    return c.json({ error: "No valid keywords after sanitization" }, 400);
  }

  // Get AI settings
  const aiSettings = await c.env.DB.prepare(
    "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
  ).bind(session.fb_id).first<{ provider: string; model: string; api_key: string; endpoint_url: string }>();

  const provider = aiSettings?.provider || "anthropic";
  const apiKey = aiSettings?.api_key || c.env.ANTHROPIC_API_KEY;
  const model = aiSettings?.model || "claude-haiku-4-5-20251001";
  const endpoint = aiSettings?.endpoint_url || "https://api.anthropic.com/v1/messages";

  if (!apiKey) {
    return c.json({ error: "No API key configured. Go to Settings > AI to add one." }, 400);
  }

  // Calculate schedule slots
  let slots: string[];
  try {
    slots = calculateSchedule(keywords.length, body.schedule);
  } catch (e: any) {
    return c.json({ error: `Schedule error: ${e.message}` }, 400);
  }

  const tone = body.tone || "general";
  const aspectRatio = body.aspect_ratio && VALID_ASPECTS.has(body.aspect_ratio) ? body.aspect_ratio : "1:1";
  const needsText = body.type === "text" || body.type === "text+image";
  const needsImage = body.type === "text+image" || body.type === "image";

  // ── Generate content for each keyword ──
  const posts: GeneratedPost[] = [];
  const errors: { keyword: string; error: string }[] = [];

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i]!;
    const scheduledAt = slots[i] ?? slots[slots.length - 1] ?? new Date().toISOString();
    try {
      let message = "";
      let hashtags: string[] = [];
      let image_url: string | undefined;
      let image_prompt: string | undefined;

      // Generate text
      if (needsText) {
        const textResult = await generateText(keyword, tone, provider, apiKey, model, endpoint);
        message = textResult.text;
        hashtags = textResult.hashtags;
      }

      // Generate image
      if (needsImage) {
        const imgResult = await generateImageForKeyword(
          keyword, aspectRatio, body.overlay_text || false, c.env, session.fb_id,
        );
        image_url = imgResult.image_url;
        image_prompt = imgResult.prompt;

        // For image-only: use keyword as message placeholder
        if (body.type === "image" && !message) {
          message = keyword;
        }
      }

      posts.push({
        keyword,
        message,
        hashtags,
        image_url,
        image_prompt,
        scheduled_at: scheduledAt,
      });
    } catch (e: any) {
      errors.push({ keyword, error: e.message });
    }
  }

  // Log to prompt_logs
  try {
    await c.env.DB.prepare(
      "INSERT INTO prompt_logs (user_fb_id, type, prompt, result, model, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      session.fb_id,
      "bulk",
      JSON.stringify({ keywords, type: body.type, tone, schedule: body.schedule }),
      JSON.stringify({ generated: posts.length, errors: errors.length }),
      model,
      new Date().toISOString(),
    ).run();
  } catch {
    // Non-critical logging
  }

  return c.json({
    ok: true,
    total: keywords.length,
    generated: posts.length,
    posts,
    errors,
  });
});

export default bulk;
