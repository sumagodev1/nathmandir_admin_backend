-- Generic content hierarchy: a tree of nodes under a Part.
--
--   Gitanjali Part 1 (product)
--    ├── सकाळी            (node, parent NULL)
--    └── संध्याकाळी        (node, parent NULL)
--         ├── वाराची पदे    (node)
--         │    ├── शुक्रवार  (node) → content items
--         │    └── …
--         └── स्तोत्र       (node) → content items
--
-- Nothing here names a level. Depth, names and ordering are all data, so a
-- Part can have two levels or five, and another Part can have a completely
-- different shape.
CREATE TABLE `content_node` (
    `id`         INTEGER      NOT NULL AUTO_INCREMENT,
    `product_id` INTEGER      NOT NULL,
    `parent_id`  INTEGER      NULL,
    `name`       VARCHAR(191) NOT NULL,
    -- Free-text display hint only ("session", "sub part", "day"). No code
    -- branches on it — it exists so the UI can label a level without the
    -- application knowing what the level means.
    `kind`       VARCHAR(64)  NULL,
    `sort_order` INTEGER      NOT NULL DEFAULT 0,
    `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `content_node_product_id_parent_id_sort_order_idx`(`product_id`, `parent_id`, `sort_order`),
    INDEX `content_node_parent_id_idx`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `content_node` ADD CONSTRAINT `content_node_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- A node's parent is another node. Deleting a parent is blocked in the
-- controller while it still has children, so this never cascades a whole
-- branch away by accident.
ALTER TABLE `content_node` ADD CONSTRAINT `content_node_parent_id_fkey`
    FOREIGN KEY (`parent_id`) REFERENCES `content_node`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Which node an item sits in. NULL on every existing row — those items stay
-- directly in their Part and behave exactly as they did before.
ALTER TABLE `content` ADD COLUMN `node_id` INTEGER NULL;

CREATE INDEX `content_node_id_idx` ON `content`(`node_id`);

ALTER TABLE `content` ADD CONSTRAINT `content_node_id_fkey`
    FOREIGN KEY (`node_id`) REFERENCES `content_node`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
