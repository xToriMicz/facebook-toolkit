CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT,
  image_url TEXT,
  fb_post_id TEXT,
  status TEXT DEFAULT 'posted',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fb_id TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  picture_url TEXT,
  access_token TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fb_user_id TEXT NOT NULL,
  confirmation_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  template_text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'ทั่วไป',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_fb_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  message TEXT NOT NULL,
  image_url TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  fb_post_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_posts(status, scheduled_at);
