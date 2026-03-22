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
