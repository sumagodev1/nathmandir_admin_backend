#!/usr/bin/env node
// One-time migration: copy legacy flag columns → user_access rows.
// Safe to run multiple times — uses findUnique + create (not upsert) so existing
// manually-granted rows (source='granted') are never overwritten with 'purchased'.
//
// Usage:
//   node scripts/migrate_flags_to_access.js
//
// What it does:
//   For every user whose part1 / part2 / upasanaPaid / nityaniyamPaid flag = 1,
//   create a user_access row (source='purchased', expiresOn=null = permanent)
//   IF one does not already exist for that (userId, productId) pair.
//
// After running this script, user_access is the single source of truth.
// The flag columns are left intact (no ALTER TABLE) so the data is preserved
// and a rollback is safe. Code no longer reads them.

import { PrismaClient } from '@prisma/client'

const LEGACY_FLAGS = [
  { flag: 'part1',          productId: 'gita1'   },
  { flag: 'part2',          productId: 'gita2'   },
  { flag: 'upasanaPaid',    productId: 'upasana' },
  { flag: 'nityaniyamPaid', productId: 'nithya'  },
]

const prisma = new PrismaClient()

try {
  // Verify all legacy products exist before migrating
  for (const { productId } of LEGACY_FLAGS) {
    const p = await prisma.product.findUnique({ where: { id: productId } })
    if (!p) console.warn(`  WARN: product '${productId}' not found in products table — rows pointing to it will be skipped.`)
  }

  // Fetch only users who have at least one flag set
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { part1: 1 },
        { part2: 1 },
        { upasanaPaid: 1 },
        { nityaniyamPaid: 1 },
      ],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      part1: true,
      part2: true,
      upasanaPaid: true,
      nityaniyamPaid: true,
    },
  })

  console.log(`Found ${users.length} user(s) with at least one legacy access flag.\n`)

  let migrated = 0
  let alreadyExisted = 0
  let productMissing = 0

  for (const user of users) {
    for (const { flag, productId } of LEGACY_FLAGS) {
      if (user[flag] !== 1) continue

      // Skip if the product doesn't exist (e.g. DB was reset)
      const product = await prisma.product.findUnique({ where: { id: productId } })
      if (!product) {
        console.log(`  SKIP (no product): user ${user.id} (${user.name}) → '${productId}'`)
        productMissing++
        continue
      }

      // Skip if a row already exists (any source — don't overwrite granted rows)
      const existing = await prisma.userAccess.findUnique({
        where: { userId_productId: { userId: user.id, productId } },
      })
      if (existing) {
        console.log(`  EXISTS [${existing.source}]: user ${user.id} (${user.name}) → '${productId}'`)
        alreadyExisted++
        continue
      }

      await prisma.userAccess.create({
        data: {
          userId: user.id,
          productId,
          source: 'purchased',
          grantedOn: new Date(),
          expiresOn: null, // permanent — they paid for it
        },
      })
      console.log(`  MIGRATED: user ${user.id} (${user.name}) → '${productId}'`)
      migrated++
    }
  }

  console.log('\n─────────────────────────────────────────')
  console.log(`Migrated (new rows created):  ${migrated}`)
  console.log(`Skipped  (row already exists): ${alreadyExisted}`)
  console.log(`Skipped  (product not found):  ${productMissing}`)
  console.log('─────────────────────────────────────────')
  console.log('Migration complete. user_access is now the single source of truth.')
  console.log('The flag columns are still in the DB — no schema changes were made.')
} finally {
  await prisma.$disconnect()
}
