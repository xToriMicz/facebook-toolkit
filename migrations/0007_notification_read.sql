-- Notification: add read_at to activity_logs
ALTER TABLE activity_logs ADD COLUMN read_at TEXT;
