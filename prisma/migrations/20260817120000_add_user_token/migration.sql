-- JWT issued to the mobile app on OTP verify (schema.prisma had the field,
-- but no migration ever added the column — /api/dashboard/stats 500'd on it).
ALTER TABLE `users` ADD COLUMN `token` TEXT NULL;
