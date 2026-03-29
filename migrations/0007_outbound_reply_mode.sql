-- Add reply_mode to target_pages (all = ทุกโพส, random = บางโพส, one = โพสเดียว/วัน)
ALTER TABLE target_pages ADD COLUMN reply_mode TEXT DEFAULT 'all';
