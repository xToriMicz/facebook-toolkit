-- Outbound Comments: ไปคอมเม้นเพจอื่น
CREATE TABLE IF NOT EXISTS target_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_fb_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  target_page_id TEXT NOT NULL,
  target_page_name TEXT,
  target_page_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  max_per_day INTEGER NOT NULL DEFAULT 1,
  comment_tone TEXT DEFAULT 'casual',
  custom_prompt TEXT,
  last_commented_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_fb_id, page_id, target_page_id)
);

CREATE TABLE IF NOT EXISTS outbound_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_fb_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  target_page_id TEXT NOT NULL,
  target_post_id TEXT NOT NULL,
  post_message TEXT,
  post_type TEXT,
  comment_text TEXT NOT NULL,
  comment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outbound_target ON outbound_comments(target_page_id, target_post_id);
CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_comments(status);
CREATE INDEX IF NOT EXISTS idx_target_pages_user ON target_pages(user_fb_id, page_id);
