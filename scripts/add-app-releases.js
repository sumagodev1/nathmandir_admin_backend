// ── Android app release history table ─────────────────────────
// Creates `app_releases`: one row per APK ever uploaded in Admin → App
// Download. The row with is_live = 1 is the one the website's "Download APK"
// button serves; with none live, the button is hidden.
//
// `file` is set to NULL when an admin deletes an old version's file to free
// disk space — the row itself stays, so the history is never lost.
//
// Before this table, only the latest APK was kept, as JSON in the settings
// row "app.apk". If that row exists it is copied in as the live release and
// then removed.
//
// Applied as raw SQL rather than `prisma migrate`, which would want to reset
// this database. Safe to run twice.
//
//   node scripts/add-app-releases.js
//   npx prisma generate                          # afterwards, once
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const hasTable = async (name) =>
  Number(
    (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) c FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = ?`,
      name
    ))[0].c
  ) > 0

async function main() {
  if (await hasTable('app_releases')) {
    console.log('✓ app_releases table already exists')
  } else {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE app_releases (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        version         VARCHAR(30)  NOT NULL DEFAULT '',
        original_name   VARCHAR(255) NOT NULL,
        file            VARCHAR(191) NULL,
        size            BIGINT       NOT NULL DEFAULT 0,
        is_live         TINYINT(1)   NOT NULL DEFAULT 0,
        uploaded_by     VARCHAR(191) NULL,
        uploaded_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        file_deleted_at DATETIME(3)  NULL,
        KEY app_releases_is_live_idx (is_live)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    console.log('✓ created app_releases')
  }

  // Carry over the APK uploaded before history existed.
  const [old] = await prisma.$queryRawUnsafe(`SELECT value FROM settings WHERE \`key\` = 'app.apk'`)
  if (old?.value) {
    let apk = null
    try { apk = JSON.parse(old.value) } catch { /* unreadable — just drop it */ }
    if (apk?.file) {
      await prisma.$executeRawUnsafe(`UPDATE app_releases SET is_live = 0`)
      await prisma.$executeRawUnsafe(
        `INSERT INTO app_releases (version, original_name, file, size, is_live, uploaded_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
        apk.version || '',
        apk.originalName || apk.file,
        apk.file,
        Number(apk.size) || 0,
        apk.uploadedAt ? new Date(apk.uploadedAt) : new Date()
      )
      console.log(`✓ copied the current APK (${apk.originalName || apk.file}) into app_releases`)
    }
    await prisma.$executeRawUnsafe(`DELETE FROM settings WHERE \`key\` = 'app.apk'`)
    console.log('✓ removed the old settings row app.apk')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
