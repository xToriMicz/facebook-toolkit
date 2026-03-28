-- Migrate auto_reply_settings from per-user to per-page
-- Drop old UNIQUE constraint on user_fb_id, add page_id column

-- SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so recreate
CREATE TABLE IF NOT EXISTS auto_reply_settings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_fb_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  reply_mode TEXT NOT NULL DEFAULT 'all',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_fb_id, page_id)
);

-- Migrate existing data (copy to all user pages)
INSERT OR IGNORE INTO auto_reply_settings_new (user_fb_id, page_id, enabled, created_at)
  SELECT ars.user_fb_id, up.page_id, ars.enabled, ars.created_at
  FROM auto_reply_settings ars
  JOIN user_pages up ON ars.user_fb_id = up.user_fb_id;

DROP TABLE IF EXISTS auto_reply_settings;
ALTER TABLE auto_reply_settings_new RENAME TO auto_reply_settings;
