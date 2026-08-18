// ── Legacy `user` → `users` (+ user_access) ───────────────────
// The devotees live in the legacy `user` table (the nathmand_db import).
// Everything the admin panel and the mobile API read goes through Prisma's
// `users` table, so until a row is in there the person does not exist as far
// as the panel is concerned: Access Control shows an empty matrix, and the
// Payments list shows "#22" and a dash instead of a name and a phone number.
//
// This copies the missing ones across. Two things it is careful about:
//
//   • IDs are preserved. `user_payment.user_id` and `userpayment` point at the
//     legacy ids, so changing them would orphan 1282 payment rows.
//   • The four paid flags (Part_1, Part_2, upasanaPaid, nityaniyamPaid) become
//     real `user_access` rows. Access Control reads that table, not the flags,
//     so without this step every devotee would import as "No access" however
//     much they have paid.
//
// Insert-only and idempotent: a legacy id already present in `users` is left
// exactly as it is, so this can be re-run after new devotees are imported.
//
//   node scripts/import-legacy-users.js           # report only, writes nothing
//   node scripts/import-legacy-users.js --apply   # do it
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const APPLY = process.argv.includes('--apply')

// legacy flag column → the product it grants.
const FLAG_PRODUCTS = {
  Part_1: 'gita1',
  Part_2: 'gita2',
  upasanaPaid: 'upasana',
  nityaniyamPaid: 'nithya',
}

// A blank/garbage phone would break OTP login, and `city` is NOT NULL in the
// target while the legacy rows often leave it empty.
const str = (v) => (v === null || v === undefined ? '' : String(v).trim())

async function main() {
  const legacy = await prisma.$queryRawUnsafe('SELECT * FROM `user` ORDER BY id')
  const existing = await prisma.user.findMany({ select: { id: true } })
  const have = new Set(existing.map((u) => u.id))

  const fresh = legacy.filter((r) => !have.has(Number(r.id)))
  const skipped = legacy.length - fresh.length

  console.log(`legacy \`user\` rows : ${legacy.length}`)
  console.log(`already in \`users\` : ${skipped}`)
  console.log(`to import          : ${fresh.length}`)

  // A skipped id is normally the same person on both sides. When it is not,
  // the legacy devotee would be dropped without a word and their payments
  // would read as somebody else's, so say so loudly and refuse to write.
  const byId = new Map(
    (await prisma.user.findMany({ select: { id: true, name: true, phone: true } })).map((u) => [u.id, u])
  )
  const clashes = legacy
    .filter((r) => byId.has(Number(r.id)))
    .map((r) => ({ legacy: r, mine: byId.get(Number(r.id)) }))
    .filter((c) => str(c.legacy.mobile) !== str(c.mine.phone))

  if (clashes.length) {
    console.log(`\n!  ${clashes.length} id(s) already taken by a DIFFERENT person:`)
    for (const c of clashes) {
      console.log(`   id ${c.legacy.id}: legacy "${str(c.legacy.name)}" (${str(c.legacy.mobile)})` +
        `  vs  existing "${c.mine.name}" (${c.mine.phone})`)
    }
    console.log('   Payment rows point at the legacy id, so importing over this')
    console.log('   would attach their history to the wrong name.')
    console.log('   Remove or renumber the existing row first, then re-run.')
  }

  // Rows with no usable phone still import — they are real payment history —
  // but they can never log in, so say how many there are rather than hide it.
  const noPhone = fresh.filter((r) => !str(r.mobile)).length
  if (noPhone) console.log(`  (${noPhone} of them have no mobile number and will not be able to log in)`)

  const products = await prisma.product.findMany({ select: { id: true, code: true } })
  const productIdBy = new Map(products.map((p) => [p.code, p.id]))

  // How many access rows the flags will produce, per product.
  const grantCount = {}
  for (const r of fresh) {
    for (const [flag, code] of Object.entries(FLAG_PRODUCTS)) {
      if (Number(r[flag]) === 1) grantCount[code] = (grantCount[code] || 0) + 1
    }
  }
  const totalGrants = Object.values(grantCount).reduce((a, b) => a + b, 0)
  console.log(`\naccess rows from the paid flags: ${totalGrants}`)
  for (const [code, n] of Object.entries(grantCount)) console.log(`  ${code.padEnd(10)} ${n}`)

  if (clashes.length && APPLY) {
    throw new Error(`${clashes.length} id collision(s) — refusing to write. See the list above.`)
  }
  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    return
  }
  if (!fresh.length) {
    console.log('\nNothing to import.')
    return
  }

  // One statement rather than 520 round trips. Column names are fixed literals
  // here; only the values are parameterised.
  const COLS = [
    'id', 'name', 'phone', 'city', 'status', 'registered_on', 'created_at',
    'address', 'amount', 'donation', 'donation_audio', 'email', 'is_paid',
    'nityaniyam_paid', 'otp', 'part_1', 'part_2', 'upasana_paid',
    'updated_at', 'updated_at2',
  ]
  const CHUNK = 100
  let inserted = 0

  for (let i = 0; i < fresh.length; i += CHUNK) {
    const batch = fresh.slice(i, i + CHUNK)
    const values = []
    const params = []
    for (const r of batch) {
      // `active` is 1/0 in the legacy table; `status` is an enum here.
      const status = Number(r.active) === 0 ? 'disabled' : 'active'
      const created = r.createdAt || new Date()
      params.push(
        Number(r.id), str(r.name) || 'Unnamed', str(r.mobile), str(r.city),
        status, created, created,
        r.address ?? null, r.amount ?? null,
        Number(r.donation) || 0, Number(r.donation_audio) || 0,
        r.email ?? '', Number(r.isPaid) || 0,
        Number(r.nityaniyamPaid) || 0, r.otp ?? null,
        Number(r.Part_1) || 0, Number(r.Part_2) || 0, Number(r.upasanaPaid) || 0,
        r.updatedAt ?? null, r.updatedAt2 ?? null
      )
      values.push(`(${COLS.map(() => '?').join(',')})`)
    }
    const sql =
      `INSERT INTO \`users\` (${COLS.map((c) => `\`${c}\``).join(',')}) VALUES ${values.join(',')}`
    inserted += await prisma.$executeRawUnsafe(sql, ...params)
    console.log(`  inserted ${Math.min(i + CHUNK, fresh.length)}/${fresh.length}`)
  }
  console.log(`\nusers inserted: ${inserted}`)

  // Then the access rows. skipDuplicates covers the unique (userId, productId),
  // so re-running never doubles a grant.
  const access = []
  for (const r of fresh) {
    for (const [flag, code] of Object.entries(FLAG_PRODUCTS)) {
      if (Number(r[flag]) !== 1) continue
      const productId = productIdBy.get(code)
      if (!productId) continue
      access.push({
        userId: Number(r.id),
        productId,
        // They paid — this is not an admin hand-out.
        source: 'purchased',
        // Permanent: the legacy flag carries no expiry, and inventing one
        // would silently cut people off.
        expiresOn: null,
        grantedOn: r.createdAt || new Date(),
      })
    }
  }
  if (access.length) {
    const res = await prisma.userAccess.createMany({ data: access, skipDuplicates: true })
    console.log(`access rows created: ${res.count}`)
  }
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
