-- Add image_urls column for multi-photo scheduled posts
ALTER TABLE scheduled_posts ADD COLUMN image_urls TEXT;
