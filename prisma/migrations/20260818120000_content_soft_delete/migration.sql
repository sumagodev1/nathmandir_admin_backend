-- Soft delete for content items.
-- NULL = live. A timestamp means the row is in the bin: hidden from every
-- list and from the mobile API, but still on disk so it can be restored.
ALTER TABLE `content` ADD COLUMN `deleted_at` DATETIME(3) NULL;

CREATE INDEX `content_deleted_at_idx` ON `content`(`deleted_at`);
