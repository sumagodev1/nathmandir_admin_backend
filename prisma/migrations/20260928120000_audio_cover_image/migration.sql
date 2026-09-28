-- Artwork for audio items, shown by the app in the player and lock screen.
-- Both columns are optional: a song with no cover falls back to its Part's
-- cover, and a Part with none simply sends null. Existing rows are untouched.
ALTER TABLE `content` ADD COLUMN `cover_url` TEXT NULL;

ALTER TABLE `products` ADD COLUMN `cover_url` TEXT NULL;
