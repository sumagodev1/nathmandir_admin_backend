-- Performance indexes.
--
-- Every index below backs a WHERE / ORDER BY / groupBy that the admin panel,
-- public website or mobile API actually issues. Names match what Prisma
-- generates from the @@index() declarations in schema.prisma.
--
-- NOTE: on a database that already has these (the current dev/production box),
-- run `node prisma/apply-indexes.js` instead — it skips indexes that exist.

-- users: OTP login looks up by phone; the admin list filters status + date
CREATE INDEX `users_phone_idx` ON `users`(`phone`);
CREATE INDEX `users_status_idx` ON `users`(`status`);
CREATE INDEX `users_registered_on_idx` ON `users`(`registered_on`);

-- content: the list query is ORDER BY (product_id, sort_order); app feed filters published
CREATE INDEX `content_product_id_sort_order_idx` ON `content`(`product_id`, `sort_order`);
CREATE INDEX `content_published_idx` ON `content`(`published`);

-- user_access: "is this grant still valid" filters on expires_on everywhere
CREATE INDEX `user_access_expires_on_idx` ON `user_access`(`expires_on`);

-- sales: revenue reports filter by status and slice by date
CREATE INDEX `sales_status_idx` ON `sales`(`status`);
CREATE INDEX `sales_created_at_idx` ON `sales`(`created_at`);

-- notifications: history is ordered by sent_on, filtered by audience
CREATE INDEX `notifications_sent_on_idx` ON `notifications`(`sent_on`);
CREATE INDEX `notifications_audience_idx` ON `notifications`(`audience`);

-- public website listings: published + category, then sort_order
CREATE INDEX `books_published_category_idx` ON `books`(`published`, `category`);
CREATE INDEX `books_sort_order_idx` ON `books`(`sort_order`);
CREATE INDEX `chapters_book_id_sort_order_idx` ON `chapters`(`book_id`, `sort_order`);
CREATE INDEX `albums_published_category_idx` ON `albums`(`published`, `category`);
CREATE INDEX `photos_album_id_sort_order_idx` ON `photos`(`album_id`, `sort_order`);
CREATE INDEX `pages_published_idx` ON `pages`(`published`);
