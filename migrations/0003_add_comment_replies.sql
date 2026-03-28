-- Auto Reply Comment tracking
CREATE TABLE IF NOT EXISTS comment_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_fb_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  comment_id TEXT NOT NULL UNIQUE,
  comment_text TEXT,
  comment_from TEXT,
  comment_type TEXT NOT NULL DEFAULT 'unknown',
  reply_text TEXT,
  reply_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comment_replies_status ON comment_replies(status);
CREATE INDEX IF NOT EXISTS idx_comment_replies_post ON comment_replies(post_id);

-- Auto-reply settings per user
CREATE TABLE IF NOT EXISTS auto_reply_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_fb_id TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
