-- CreateTable
CREATE TABLE `site_sections` (
    `key` VARCHAR(191) NOT NULL,
    `data` TEXT NOT NULL,
    `updated_on` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
