import { getCookie } from "hono/cookie";

export interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  KV: KVNamespace;
  FB_APP_SECRET: string;
  ANTHROPIC_API_KEY: string;
  TOKEN_ENCRYPTION_KEY: string;
  WEBHOOK_VERIFY_TOKEN: string;
}

// ── Token Encryption (AES-256-GCM) ──

const ENC_ALGO = "AES-GCM";
const IV_LENGTH = 12;

async function getEncryptionKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32)),
    { name: ENC_ALGO }, false, ["encrypt", "decrypt"]
  );
  return keyMaterial;
}

export async function encryptToken(token: string, secret: string): Promise<string> {
  if (!token || !secret) return token;
  const key = await getEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encrypted = await crypto.subtle.encrypt(
    { name: ENC_ALGO, iv }, key, new TextEncoder().encode(token)
  );
  const combined = new Uint8Array(IV_LENGTH + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), IV_LENGTH);
  return "enc:" + btoa(String.fromCharCode(...combined));
}

export async function decryptToken(stored: string, secret: string): Promise<string> {
  if (!stored || !secret) return stored;
  if (!stored.startsWith("enc:")) return stored; // plaintext fallback for migration
  const data = Uint8Array.from(atob(stored.slice(4)), c => c.charCodeAt(0));
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);
  const key = await getEncryptionKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: ENC_ALGO, iv }, key, ciphertext
  );
  return new TextDecoder().decode(decrypted);
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

// Per-user KV helpers — prefix keys with user fb_id to prevent cross-user leaks
export function userKey(fbId: string, key: string): string {
  return `u:${fbId}:${key}`;
}

export async function getUserPageId(kv: KVNamespace, fbId: string): Promise<string | null> {
  return kv.get(userKey(fbId, "page_id"));
}

export async function getUserPageToken(kv: KVNamespace, fbId: string, encryptionKey?: string): Promise<string | null> {
  const stored = await kv.get(userKey(fbId, "page_token"));
  if (!stored) return null;
  if (encryptionKey && stored.startsWith("enc:")) {
    return decryptToken(stored, encryptionKey);
  }
  return stored;
}

export async function setUserPage(kv: KVNamespace, fbId: string, pageId: string, pageToken: string, pageName: string, encryptionKey?: string): Promise<void> {
  const storedToken = encryptionKey ? await encryptToken(pageToken, encryptionKey) : pageToken;
  await Promise.all([
    kv.put(userKey(fbId, "page_id"), pageId),
    kv.put(userKey(fbId, "page_token"), storedToken),
    kv.put(userKey(fbId, "page_name"), pageName),
  ]);
}

// Get decrypted page token from D1
export async function getDecryptedPageToken(db: D1Database, fbId: string, pageId: string, encryptionKey?: string): Promise<string | null> {
  const row = await db.prepare(
    "SELECT page_token FROM user_pages WHERE user_fb_id = ? AND page_id = ?"
  ).bind(fbId, pageId).first<{ page_token: string }>();
  if (!row?.page_token) return null;
  if (encryptionKey && row.page_token.startsWith("enc:")) {
    return decryptToken(row.page_token, encryptionKey);
  }
  return row.page_token;
}

export async function clearUserPage(kv: KVNamespace, fbId: string): Promise<void> {
  await Promise.all([
    kv.delete(userKey(fbId, "page_id")),
    kv.delete(userKey(fbId, "page_token")),
    kv.delete(userKey(fbId, "page_name")),
  ]);
}
