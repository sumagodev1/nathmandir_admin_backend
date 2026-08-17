-- CreateTable
CREATE TABLE `content_schedule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `content_id` INTEGER NOT NULL,
    `session` ENUM('morning', 'afternoon') NOT NULL,
    `day` ENUM('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') NOT NULL,

    INDEX `content_schedule_content_id_idx`(`content_id`),
    INDEX `content_schedule_session_day_idx`(`session`, `day`),
    UNIQUE INDEX `content_schedule_content_id_session_day_key`(`content_id`, `session`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `content_schedule` ADD CONSTRAINT `content_schedule_content_id_fkey` FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
