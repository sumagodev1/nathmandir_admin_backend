-- Indexes for the legacy production tables (the ones created by
-- legacy-tables.sql, not managed by schema.prisma).
--
-- These tables shipped with a PRIMARY KEY and nothing else, so every lookup
-- below was a full table scan. Applied by `node prisma/apply-indexes.js`,
-- which skips any index that already exists.

-- login_user — mobile.controller deletes/reads by mobile on every OTP verify
-- and checks (mobile, device_id) on every session check.
CREATE INDEX `login_user_mobile_idx` ON `login_user`(`mobile`);
CREATE INDEX `login_user_mobile_device_id_idx` ON `login_user`(`mobile`, `device_id`);

-- user_payment — receipts read WHERE user_id = ? AND status = '1';
-- the admin Payments list joins on user_id and orders by created_at DESC.
CREATE INDEX `user_payment_user_id_status_idx` ON `user_payment`(`user_id`, `status`);
CREATE INDEX `user_payment_created_at_idx` ON `user_payment`(`created_at`);

-- userpayment (legacy Instamojo) — ORDER BY createAt DESC
CREATE INDEX `userpayment_create_at_idx` ON `userpayment`(`createAt`);
CREATE INDEX `userpayment_mobile_idx` ON `userpayment`(`mobile`);

-- NOTE: no index on `user_donation`. Adding one needs a table rebuild, which
-- MySQL refuses because that legacy table's `updatedAt` column carries a
-- zero-date default that the current sql_mode rejects (error 1067). The table
-- holds a handful of rows and is read unfiltered, so there is nothing to gain
-- — fix the column default first if that ever changes.

-- NOTE: the `contact` list is a `name/email/message LIKE '%…%'` search. A
-- leading wildcard cannot use a B-tree index, so no index is added here — that
-- one needs a FULLTEXT index to speed up, which changes the query semantics.
