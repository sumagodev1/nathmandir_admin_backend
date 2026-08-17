// ── Create one admin login ────────────────────────────────────
// Adds a single row to `admins` without touching any other table
// (unlike prisma/seed.js, which clears everything first).
//
// Run with:  node scripts/create-admin.js [email] [password] [name]
// Defaults:  admin@gitanjali.app / admin123 / Super Admin
// Re-running with the same email just resets that admin's password.
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma.js'

const email = (process.argv[2] || 'admin@gitanjali.app').trim().toLowerCase()
const password = process.argv[3] || 'admin123'
const name = process.argv[4] || 'Super Admin'

async function main() {
  const passwordHash = await bcrypt.hash(password, 10)
  const admin = await prisma.admin.upsert({
    where: { email },
    update: { passwordHash, name },
    create: { email, passwordHash, name, role: 'super_admin' },
  })
  console.log(`✓ admin #${admin.id} ready — ${email} / ${password}`)
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
