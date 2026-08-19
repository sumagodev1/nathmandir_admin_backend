// ── Gallery categories become a master ────────────────────────
// Categories used to be two hard-coded entries in the frontend, with albums
// storing the slug as free text. An admin could not add "मंदिर" without a code
// change, and a typo made a category that only ever held one album.
//
// This creates the `gallery_category` table, seeds it from the categories the
// albums already use (plus the two the panel shipped with), and links each
// album to its row.
//
// `albums.category` is deliberately LEFT IN PLACE. Every deployed APK filters
// on that slug, so removing it would break the gallery on phones nobody can
// update. The slug stays the wire value; the master holds the display name.
//
// Safe to run twice: it checks for the table and the column, and only fills in
// links that are still missing.
//
//   node scripts/add-gallery-categories.js
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

// The two the panel shipped with, so their Marathi names survive the move.
const KNOWN_NAMES = {
  maharaj: 'महाराजांची छायाचित्रे',
  events: 'कार्यक्रमाचे छायाचित्रे',
}

const exists = async (sql, ...args) =>
  Number((await prisma.$queryRawUnsafe(sql, ...args))[0].c) > 0

async function main() {
  // 1. The table.
  const hasTable = await exists(
    `SELECT COUNT(*) c FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'gallery_category'`
  )
  if (hasTable) {
    console.log('✓ gallery_category table already exists')
  } else {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE gallery_category (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        slug       VARCHAR(64)  NOT NULL,
        name       VARCHAR(191) NOT NULL,
        sort_order INT          NOT NULL DEFAULT 0,
        published  BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY gallery_category_slug_key (slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    // Must match albums.category, which this table is joined to by slug —
    // MySQL refuses `=` across two different collations.
    console.log('✓ created gallery_category')
  }

  // 2. albums.category_id.
  const hasCol = await exists(
    `SELECT COUNT(*) c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'albums' AND column_name = 'category_id'`
  )
  if (hasCol) {
    console.log('✓ albums.category_id already exists')
  } else {
    await prisma.$executeRawUnsafe(`ALTER TABLE albums ADD COLUMN category_id INT NULL`)
    await prisma.$executeRawUnsafe(`ALTER TABLE albums ADD INDEX albums_category_id_idx (category_id)`)
    await prisma.$executeRawUnsafe(
      `ALTER TABLE albums ADD CONSTRAINT albums_category_id_fkey
         FOREIGN KEY (category_id) REFERENCES gallery_category(id) ON DELETE SET NULL`
    )
    console.log('✓ added albums.category_id')
  }

  // 3. Seed: every slug the albums already use, plus the two shipped ones.
  const used = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT category AS slug FROM albums WHERE category IS NOT NULL AND category <> ''`
  )
  const slugs = [...new Set([...Object.keys(KNOWN_NAMES), ...used.map((r) => r.slug)])]

  let added = 0
  for (const [i, slug] of slugs.entries()) {
    const already = await prisma.$queryRawUnsafe(
      `SELECT id FROM gallery_category WHERE slug = ? LIMIT 1`,
      slug
    )
    if (already.length) continue
    await prisma.$executeRawUnsafe(
      `INSERT INTO gallery_category (slug, name, sort_order) VALUES (?, ?, ?)`,
      slug,
      KNOWN_NAMES[slug] || slug, // an unknown slug shows as itself until renamed
      i
    )
    added++
  }
  console.log(`✓ ${added} category row(s) added (${slugs.length} slug(s) in use)`)

  // 4. Link albums to their category row.
  const linked = await prisma.$executeRawUnsafe(
    `UPDATE albums a JOIN gallery_category g ON g.slug = a.category
        SET a.category_id = g.id
      WHERE a.category_id IS NULL`
  )
  console.log(`✓ linked ${linked} album(s) to a category`)

  const orphans = await prisma.$queryRawUnsafe(
    `SELECT id, title, category FROM albums WHERE category_id IS NULL`
  )
  if (orphans.length) {
    console.log(`\n⚠ ${orphans.length} album(s) still unlinked — set their category in the panel:`)
    for (const o of orphans) console.log(`   #${o.id} "${o.title}" (category "${o.category}")`)
  }
  console.log('\n  Now run: npx prisma generate')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
