-- Deleting a Part cascades to its sections, but `content.node_id` pointed at
-- those sections with RESTRICT — so the cascade was blocked and deleting a
-- Part that had sections failed outright.
--
-- SET NULL is also the safer failure mode: if a section ever disappears, its
-- items fall back to sitting directly in the Part instead of being destroyed.
-- Deleting a non-empty section through the API is still refused by
-- contentNodes.controller.js, which is where that rule belongs.
ALTER TABLE `content` DROP FOREIGN KEY `content_node_id_fkey`;

ALTER TABLE `content` ADD CONSTRAINT `content_node_id_fkey`
    FOREIGN KEY (`node_id`) REFERENCES `content_node`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
