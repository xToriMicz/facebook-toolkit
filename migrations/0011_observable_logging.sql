-- Observable Logging System
-- Principle: ทุก action ต้อง traceable — ใครสั่ง เมื่อไหร่ ผ่านช่องทางไหน ผลเป็นอย่างไร

-- Single event_logs table — trace_id group events ที่เกี่ยวข้อง
CREATE TABLE IF NOT EXISTS event_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  page_id TEXT,
  ref_id INTEGER,
  fb_post_id TEXT,
  fb_url TEXT,
  status TEXT DEFAULT 'ok',
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- เพิ่ม fb_url ใน posts table
ALTER TABLE posts ADD COLUMN fb_url TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_event_logs_trace ON event_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_type ON event_logs(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_event_logs_source ON event_logs(source, created_at);
CREATE INDEX IF NOT EXISTS idx_event_logs_page ON event_logs(page_id, created_at);
CREATE INDEX IF NOT EXISTS idx_event_logs_fb ON event_logs(fb_post_id);
