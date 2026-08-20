// ── Fill the Website Content editors ──────────────────────────
// `site_sections` starts empty, so /admin/website shows a page with no fields
// and there is nothing to edit. Meanwhile the public website renders its
// built-in text from src/data/*.js, so the site looks fine and the CMS looks
// broken — which is exactly how it was found.
//
// This copies that same text in, so the editors open pre-filled with what the
// website is already showing.
//
// Unlike prisma/seed-sections.js it reads a JSON file committed to this repo
// rather than importing the website's source. The server has no copy of the
// frontend, and that script's path still pointed at a laptop that set the
// project up ("C:/Users/harsh/Downloads/...").
//
// A section that ALREADY has content is left alone, so this can never
// overwrite something an admin has edited. Pass --force to overwrite anyway.
//
//   node scripts/seed-site-sections.js
//   node scripts/seed-site-sections.js --force
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../src/lib/prisma.js'

const FORCE = process.argv.includes('--force')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE = path.join(ROOT, 'prisma/seed-data/site-sections.json')

async function main() {
  if (!fs.existsSync(FILE)) {
    throw new Error(`Missing ${path.relative(ROOT, FILE)} — pull the latest code first.`)
  }
  const sections = JSON.parse(fs.readFileSync(FILE, 'utf8'))

  const existing = new Map(
    (await prisma.siteSection.findMany()).map((r) => [r.key, r.data])
  )

  let wrote = 0
  let kept = 0
  for (const [key, data] of Object.entries(sections)) {
    const already = existing.get(key)
    // "Has content" means more than an empty object — a row of "{}" is as
    // blank as no row at all.
    const hasContent = already && already.trim() !== '' && already.trim() !== '{}'

    if (hasContent && !FORCE) {
      console.log(`  · ${key.padEnd(9)} left alone (already has content)`)
      kept++
      continue
    }

    const json = JSON.stringify(data)
    await prisma.siteSection.upsert({
      where: { key },
      update: { data: json },
      create: { key, data: json },
    })
    console.log(`  ✓ ${key.padEnd(9)} ${(json.length / 1024).toFixed(1)} KB`)
    wrote++
  }

  console.log(`\n${wrote} section(s) written, ${kept} left alone.`)
  if (kept && !FORCE) console.log('Use --force to overwrite the ones that were kept.')
  console.log('Open /admin/website — the editors should now be filled in.')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
