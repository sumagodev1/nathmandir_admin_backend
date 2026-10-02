// ── Privacy Policy + Terms & Conditions tables ────────────────
// Creates `policies` (one row per type: privacy, terms) and
// `policy_acceptances` (which version each app user accepted).
//
// Applied as raw SQL rather than `prisma migrate`, which would want to reset
// this database. No foreign key to users on purpose: user rows get merged and
// cleaned up, and an acceptance record must never block that.
//
// Safe to run twice: each table is checked first. --with-drafts fills in the
// starter text from src/data/policyDrafts.js, but only for a type with no row
// yet — it never overwrites what an admin wrote.
//
//   node scripts/add-policies.js                 # tables only
//   node scripts/add-policies.js --with-drafts   # tables + starter text
//   npx prisma generate                          # afterwards, once
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { cleanPolicyHtml } from '../src/lib/policies.js'
import { PRIVACY_DRAFT, TERMS_DRAFT } from '../src/data/policyDrafts.js'

const WITH_DRAFTS = process.argv.includes('--with-drafts')

const hasTable = async (name) =>
  Number(
    (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) c FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = ?`,
      name
    ))[0].c
  ) > 0

async function main() {
  if (await hasTable('policies')) {
    console.log('✓ policies table already exists')
  } else {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE policies (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        type       VARCHAR(20)  NOT NULL,
        title      VARCHAR(191) NOT NULL,
        content    LONGTEXT     NOT NULL,
        version    INT          NOT NULL DEFAULT 1,
        created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY policies_type_key (type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    console.log('✓ created policies')
  }

  if (await hasTable('policy_acceptances')) {
    console.log('✓ policy_acceptances table already exists')
  } else {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE policy_acceptances (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        user_id          INT          NOT NULL,
        policy_type      VARCHAR(20)  NOT NULL,
        accepted_version INT          NOT NULL,
        accepted_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY policy_acceptances_user_id_policy_type_key (user_id, policy_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    console.log('✓ created policy_acceptances')
  }

  if (WITH_DRAFTS) {
    // Raw SQL, so this works before `prisma generate` knows the new model.
    for (const [type, draft] of [['privacy', PRIVACY_DRAFT], ['terms', TERMS_DRAFT]]) {
      const [{ c }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) c FROM policies WHERE type = ?`, type)
      if (Number(c)) {
        console.log(`• ${type}: already written — left as it is`)
        continue
      }
      await prisma.$executeRawUnsafe(
        `INSERT INTO policies (type, title, content, version) VALUES (?, ?, ?, 1)`,
        type,
        draft.title,
        cleanPolicyHtml(draft.content)
      )
      console.log(`✓ ${type}: starter text added (version 1) — review it in the admin panel`)
    }
  }

  console.log('  Now run: npx prisma generate')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
