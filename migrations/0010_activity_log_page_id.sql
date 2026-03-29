-- Add page_id and post_id to activity_logs for per-page filtering
ALTER TABLE activity_logs ADD COLUMN page_id TEXT;
ALTER TABLE activity_logs ADD COLUMN post_id TEXT;
CREATE INDEX IF NOT EXISTS idx_activity_logs_page ON activity_logs (user_fb_id, page_id, created_at);
