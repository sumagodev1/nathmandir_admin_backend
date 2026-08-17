-- Deleting a Part cascades to its sections, but a section's `parent_id`
-- pointed at another section with RESTRICT — so a Part whose tree was more
-- than one level deep could not be deleted at all. It failed with a
-- misleading "Part not found".
--
-- CASCADE here only ever fires from a Part being deleted: removing a section
-- directly is refused by contentNodes.controller.js while it still holds
-- anything, which is where that rule belongs.
ALTER TABLE `content_node` DROP FOREIGN KEY `content_node_parent_id_fkey`;

ALTER TABLE `content_node` ADD CONSTRAINT `content_node_parent_id_fkey`
    FOREIGN KEY (`parent_id`) REFERENCES `content_node`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
