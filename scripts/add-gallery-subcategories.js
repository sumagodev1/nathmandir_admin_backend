// ── Gallery categories gain a second level ────────────────────
// Adds `gallery_category.parent_id`, so a subcategory is the same row with a
// parent rather than a second table. Both levels then share one set of
// add/edit/delete/publish rules, and `slug` stays unique across the lot —
// which matters because the app filters on the slug alone and has no idea
// whether it belongs to a category or a subcategory.
//
// Existing rows keep parent_id NULL, so every category stays top-level and
// nothing moves.
//
// Safe to run twice: it checks for the column first.
//
//   node scripts/add-gallery-subcategories.js
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

async function main() {
  const [{ c }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'gallery_category' AND column_name = 'parent_id'`
  )
  if (Number(c)) {
    console.log('✓ gallery_category.parent_id already exists — nothing to do.')
    return
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE gallery_category ADD COLUMN parent_id INT NULL`)
  await prisma.$executeRawUnsafe(`ALTER TABLE gallery_category ADD INDEX gallery_category_parent_id_idx (parent_id)`)
  // RESTRICT: the database refuses to drop a category that still has children,
  // matching what the API already tells the admin.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE gallery_category ADD CONSTRAINT gallery_category_parent_id_fkey
       FOREIGN KEY (parent_id) REFERENCES gallery_category(id) ON DELETE RESTRICT ON UPDATE NO ACTION`
  )

  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) n FROM gallery_category`)
  console.log(`✓ added gallery_category.parent_id. All ${n} existing category(s) stay top-level.`)
  console.log('  Now run: npx prisma generate')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
