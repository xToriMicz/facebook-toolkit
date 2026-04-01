/**
 * Observable Logger
 *
 * Principles:
 * 1. ทุก action ต้อง traceable (trace_id group events)
 * 2. ทุก event มี source + timestamp + link
 * 3. Query ได้ filter ได้ join ได้
 * 4. Detect anomaly: duplicate, error rate
 * 5. ไม่ log sensitive data (tokens, credentials)
 */

import type { Env } from "./helpers";

export type EventType =
  | "cron_start"
  | "cron_end"
  | "api_call"
  | "api_response"
  | "post_created"
  | "post_updated"
  | "duplicate_detected"
  | "error";

export type Source =
  | "schedule_cron"
  | "bulk_cron"
  | "manual_post"
  | "analytics_sync"
  | "auto_reply";

export interface EventLog {
  trace_id: string;
  event_type: EventType;
  source: Source;
  page_id?: string;
  ref_id?: number;
  fb_post_id?: string;
  fb_url?: string;
  status?: string;
  details?: Record<string, any>;
}

/** Generate trace ID */
export function newTraceId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Facebook post URL */
export function fbUrl(fbPostId: string | null): string | null {
  if (!fbPostId) return null;
  return `https://www.facebook.com/${fbPostId}`;
}

/** Log a single event */
export async function logEvent(db: D1Database, event: EventLog): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO event_logs (trace_id, event_type, source, page_id, ref_id, fb_post_id, fb_url, status, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      event.trace_id,
      event.event_type,
      event.source,
      event.page_id || null,
      event.ref_id || null,
      event.fb_post_id || null,
      event.fb_url || fbUrl(event.fb_post_id || null),
      event.status || "ok",
      event.details ? JSON.stringify(event.details) : null
    ).run();
  } catch {
    // Logging should never break main flow
  }
}

/** Check duplicate before POST — same message_hash + page_id within 1 hour */
export async function isDuplicatePost(
  db: D1Database,
  pageId: string,
  message: string
): Promise<boolean> {
  try {
    const hash = await messageHash(message);
    const result = await db.prepare(
      `SELECT id FROM posts WHERE page_id = ? AND created_at >= datetime('now', '-1 hour')
       AND substr(message, 1, 100) = ?`
    ).bind(pageId, message.slice(0, 100)).first();
    return !!result;
  } catch {
    return false;
  }
}

/** Check duplicate for analytics sync — same message + page_id ±5 min */
export async function isDuplicateSync(
  db: D1Database,
  pageId: string,
  message: string,
  createdTime: string
): Promise<boolean> {
  try {
    const result = await db.prepare(
      `SELECT id FROM posts WHERE page_id = ?
       AND substr(message, 1, 100) = ?
       AND abs(julianday(created_at) - julianday(?)) < (5.0 / 1440.0)`
    ).bind(pageId, message.slice(0, 100), createdTime).first();
    return !!result;
  } catch {
    return false;
  }
}

/** Wrap Graph API fetch with logging */
export async function fetchGraphApi(
  db: D1Database,
  url: string,
  options: RequestInit,
  meta: {
    trace_id: string;
    endpoint: string;
    page_id?: string;
    source: Source;
    message_preview?: string;
  }
): Promise<any> {
  // Log API call
  await logEvent(db, {
    trace_id: meta.trace_id,
    event_type: "api_call",
    source: meta.source,
    page_id: meta.page_id,
    details: {
      endpoint: meta.endpoint,
      message_preview: meta.message_preview?.slice(0, 50),
    },
  });

  const start = Date.now();
  const response = await fetch(url, options);
  const duration = Date.now() - start;
  const data = (await response.json()) as any;

  const fbPostId = data.id || data.post_id || null;

  // Log API response
  await logEvent(db, {
    trace_id: meta.trace_id,
    event_type: "api_response",
    source: meta.source,
    page_id: meta.page_id,
    fb_post_id: fbPostId,
    status: data.error ? "error" : "ok",
    details: {
      endpoint: meta.endpoint,
      http_status: response.status,
      duration_ms: duration,
      fb_post_id: fbPostId,
      error: data.error ? data.error.message?.slice(0, 200) : undefined,
    },
  });

  return data;
}

/** Cleanup logs older than 30 days */
export async function cleanupOldLogs(db: D1Database): Promise<number> {
  try {
    const result = await db.prepare(
      "DELETE FROM event_logs WHERE created_at < datetime('now', '-30 days')"
    ).run();
    return result.meta.changes;
  } catch {
    return 0;
  }
}

async function messageHash(msg: string): Promise<string> {
  const data = new TextEncoder().encode(msg.slice(0, 200));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
