-- Prompt logs for AI text generation and image generation
CREATE TABLE IF NOT EXISTS prompt_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_fb_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'text' or 'image'
  prompt TEXT NOT NULL,
  result TEXT,
  model TEXT,
  tone TEXT,
  aspect_ratio TEXT,
  overlay_text TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
