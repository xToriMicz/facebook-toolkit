import { Hono } from "hono";
import { Env, getSessionFromReq, rateLimit, sanitize } from "../helpers";
import { callAI } from "../ai-providers";

const aiImage = new Hono<{ Bindings: Env }>();

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const VALID_ASPECTS = new Set(["1:1", "9:16", "16:9", "4:5", "3:4", "4:3", "2:3", "3:2", "5:4"]);

async function getGeminiKey(kv: KVNamespace, fbId: string): Promise<string | null> {
  return kv.get(`u:${fbId}:gemini_key`);
}

/** Use AI to translate Thai text into an English image prompt */
async function textToImagePrompt(text: string, env: Env, fbId: string): Promise<string> {
  const aiSettings = await env.DB.prepare(
    "SELECT provider, model, api_key, endpoint_url FROM user_ai_settings WHERE user_fb_id = ?"
  ).bind(fbId).first<{ provider: string; model: string; api_key: string; endpoint_url: string }>();

  const provider = aiSettings?.provider || "anthropic";
  const apiKey = aiSettings?.api_key || env.ANTHROPIC_API_KEY;
  const model = aiSettings?.model || "claude-haiku-4-5-20251001";
  const endpoint = aiSettings?.endpoint_url;
  if (!apiKey) throw new Error("No AI API key configured");

  const result = await callAI(provider, apiKey, model,
    `You are an image prompt engineer for social media posts. Convert the following Thai text into an English image generation prompt (max 300 chars).

Rules:
- Create a photorealistic or high-quality illustration style image (NOT infographic, NOT clip art, NOT flat icons)
- Focus on emotion, atmosphere, and visual storytelling
- Include lighting, color mood, and composition details
- Good example: "A person looking worried at a gas station pump showing high prices, warm sunset lighting, cinematic composition, shallow depth of field"
- Bad example: "Infographic about fuel prices with icons and text labels"
- Output ONLY the prompt, nothing else

Text: ${text}`,
    endpoint
  );
  return result.text.trim();
}

/** Call Gemini to generate an image, returns base64 PNG */
async function generateImage(
  apiKey: string,
  prompt: string,
  aspectRatio: string,
): Promise<{ data: string; mimeType: string }> {
  const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
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

  return { data: part.inlineData.data, mimeType: part.inlineData.mimeType || "image/png" };
}

/** Upload base64 image to R2 and return public URL */
async function uploadToR2(
  assets: R2Bucket,
  base64Data: string,
  mimeType: string,
): Promise<{ url: string; key: string }> {
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const key = `uploads/ai-${Date.now()}.${ext}`;
  const binary = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

  await assets.put(key, binary.buffer, {
    httpMetadata: { contentType: mimeType },
  });

  return { url: `https://fb.makeloops.xyz/img/${key}`, key };
}

// POST /api/ai-image/prompt — translate text to English image prompt
aiImage.post("/ai-image/prompt", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  if (await rateLimit(c.env.KV, `ai-img:${session.fb_id}`, 50)) {
    return c.json({ error: "Rate limit: max 50 AI image requests/hour" }, 429);
  }

  const { text } = await c.req.json() as { text?: string };
  if (!text) return c.json({ error: "text required" }, 400);
  if (text.length > 2000) return c.json({ error: "text too long (max 2000)" }, 400);

  try {
    const prompt = await textToImagePrompt(sanitize(text), c.env, session.fb_id);
    return c.json({ ok: true, prompt });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/ai-image/generate — generate image via Gemini + upload to R2
aiImage.post("/ai-image/generate", async (c) => {
  const session = await getSessionFromReq(c);
  if (!session) return c.json({ error: "Not authenticated" }, 401);
  if (await rateLimit(c.env.KV, `ai-img:${session.fb_id}`, 50)) {
    return c.json({ error: "Rate limit: max 50 AI image requests/hour" }, 429);
  }

  const body = await c.req.json() as {
    text?: string; prompt?: string; aspect_ratio?: string; mode?: string;
  };

  const mode = body.mode || "auto";
  const aspectRatio = body.aspect_ratio && VALID_ASPECTS.has(body.aspect_ratio) ? body.aspect_ratio : "1:1";

  // Get Gemini API key
  const geminiKey = await getGeminiKey(c.env.KV, session.fb_id);
  if (!geminiKey) {
    return c.json({ error: "Gemini API key not configured. Go to Settings to add one." }, 400);
  }

  try {
    let imagePrompt: string;

    if (mode === "direct") {
      // Direct mode: use prompt as-is
      if (!body.prompt) return c.json({ error: "prompt required for direct mode" }, 400);
      if (body.prompt.length > 2000) return c.json({ error: "prompt too long (max 2000)" }, 400);
      imagePrompt = sanitize(body.prompt);
    } else {
      // Auto mode: translate text to English prompt first
      if (!body.text) return c.json({ error: "text required for auto mode" }, 400);
      if (body.text.length > 2000) return c.json({ error: "text too long (max 2000)" }, 400);
      imagePrompt = await textToImagePrompt(sanitize(body.text), c.env, session.fb_id);
    }

    // Generate image
    const image = await generateImage(geminiKey, imagePrompt, aspectRatio);

    // Upload to R2
    const { url, key } = await uploadToR2(c.env.ASSETS, image.data, image.mimeType);

    return c.json({ ok: true, image_url: url, key, prompt: imagePrompt, aspect_ratio: aspectRatio });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default aiImage;
