-- Auto Reply: add tone + skip greeting settings
ALTER TABLE auto_reply_settings ADD COLUMN reply_tone TEXT NOT NULL DEFAULT 'formal';
ALTER TABLE auto_reply_settings ADD COLUMN custom_tone TEXT;
ALTER TABLE auto_reply_settings ADD COLUMN skip_greeting INTEGER NOT NULL DEFAULT 0;
