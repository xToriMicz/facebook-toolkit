-- Bulk Generate v2: Cron-based plan + items
CREATE TABLE IF NOT EXISTS bulk_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_fb_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  name TEXT,
  tone TEXT DEFAULT 'general',
  post_type TEXT DEFAULT 'text',
  date_start TEXT NOT NULL,
  date_end TEXT NOT NULL,
  time_start TEXT DEFAULT '08:00',
  time_end TEXT DEFAULT '20:00',
  frequency TEXT DEFAULT 'auto',
  freq_value INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  total_items INTEGER DEFAULT 0,
  generated INTEGER DEFAULT 0,
  posted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bulk_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES bulk_plans(id),
  user_fb_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  angle TEXT,
  scheduled_at TEXT NOT NULL,
  message TEXT,
  image_url TEXT,
  fb_post_id TEXT,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  generated_at TEXT,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bpi_status ON bulk_plan_items(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_bpi_plan ON bulk_plan_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_bp_user ON bulk_plans(user_fb_id, page_id);
