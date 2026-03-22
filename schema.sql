CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT,
  image_url TEXT,
  fb_post_id TEXT,
  status TEXT DEFAULT 'posted',
  created_at TEXT NOT NULL
);
