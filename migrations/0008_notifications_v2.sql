-- Notification System v2 — แยก table จาก activity_logs
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_fb_id TEXT NOT NULL,
  page_id TEXT,
  type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  detail TEXT,
  link TEXT,
  source_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_fb_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notif_priority ON notifications(user_fb_id, priority, created_at);

-- Notification preferences per user
CREATE TABLE IF NOT EXISTS notification_prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_fb_id TEXT NOT NULL UNIQUE,
  auto_reply INTEGER NOT NULL DEFAULT 1,
  outbound INTEGER NOT NULL DEFAULT 1,
  post_ok INTEGER NOT NULL DEFAULT 1,
  post_fail INTEGER NOT NULL DEFAULT 1,
  scheduled INTEGER NOT NULL DEFAULT 1,
  comment_new INTEGER NOT NULL DEFAULT 1,
  error INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
