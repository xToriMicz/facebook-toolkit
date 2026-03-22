export interface AIResponse {
  text: string;
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function callAnthropic(apiKey: string, model: string, prompt: string): Promise<AIResponse> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message);
  return {
    text: data.content?.[0]?.text || "",
    model: data.model || model,
    usage: { input_tokens: data.usage?.input_tokens, output_tokens: data.usage?.output_tokens },
  };
}

async function callOpenAI(apiKey: string, model: string, prompt: string): Promise<AIResponse> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
    }),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message);
  return {
    text: data.choices?.[0]?.message?.content || "",
    model: data.model || model,
    usage: { input_tokens: data.usage?.prompt_tokens, output_tokens: data.usage?.completion_tokens },
  };
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<AIResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1024 },
    }),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message);
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
    model,
    usage: { input_tokens: data.usageMetadata?.promptTokenCount, output_tokens: data.usageMetadata?.candidatesTokenCount },
  };
}

async function callCustom(apiKey: string, model: string, endpoint: string, prompt: string): Promise<AIResponse> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
    }),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(typeof data.error === "string" ? data.error : data.error.message);
  return {
    text: data.choices?.[0]?.message?.content || "",
    model: data.model || model,
  };
}

export async function callAI(
  provider: string,
  apiKey: string,
  model: string,
  prompt: string,
  endpoint?: string,
): Promise<AIResponse> {
  switch (provider) {
    case "anthropic": return callAnthropic(apiKey, model, prompt);
    case "openai": return callOpenAI(apiKey, model, prompt);
    case "gemini": return callGemini(apiKey, model, prompt);
    case "custom":
      if (!endpoint) throw new Error("Custom provider requires endpoint URL");
      return callCustom(apiKey, model, endpoint, prompt);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
