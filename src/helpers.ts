import { getCookie } from "hono/cookie";

export interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  KV: KVNamespace;
  FB_APP_SECRET: string;
  ANTHROPIC_API_KEY: string;
}

// KV cache helper (read-through cache)
export async function kvCache<T>(kv: KVNamespace, key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = await kv.get(key);
  if (cached) return JSON.parse(cached) as T;
  const data = await fetcher();
  await kv.put(key, JSON.stringify(data), { expirationTtl: ttl });
  return data;
}

// Rate limiter per hour
export async function rateLimit(kv: KVNamespace, key: string, maxPerHour: number): Promise<boolean> {
  const hour = new Date().toISOString().slice(0, 13);
  const k = `rl:${key}:${hour}`;
  const count = parseInt(await kv.get(k) || "0");
  if (count >= maxPerHour) return true;
  await kv.put(k, String(count + 1), { expirationTtl: 3600 });
  return false;
}

// Sanitize input: strip script tags and event handlers
export function sanitize(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/<\/?script[^>]*>/gi, "");
}

// Get session from cookie
export async function getSessionFromReq(c: any): Promise<any | null> {
  const sessionId = getCookie(c, "session");
  if (!sessionId) return null;
  const data = await c.env.KV.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}
