-- Website content sections are stored as one JSON blob per section. TEXT caps
-- that blob at 64 KB, and the "library" section (the full text of the 35 Kiran
-- of the Shri Madhavnath Deepprakash, ~1.2 MB) is far larger.
--
-- MySQL/MariaDB without strict mode do not reject an over-long value: they cut
-- it off silently, leaving broken JSON behind. LONGTEXT (up to 4 GB) removes
-- the cap. Widening only — every existing row is kept exactly as it is.
ALTER TABLE `site_sections` MODIFY `data` LONGTEXT NOT NULL;
