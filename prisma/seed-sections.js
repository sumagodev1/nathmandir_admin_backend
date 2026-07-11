// ── Seed website content sections ─────────────────────────────
// Populates the `site_sections` table from the website's existing
// (already tri-lingual) static data, so the admin editors start
// pre-filled with the current content instead of blank.
//
// Run once:  node prisma/seed-sections.js
import 'dotenv/config'
import { pathToFileURL } from 'url'
import { prisma } from '../src/lib/prisma.js'

// Absolute path to the website's data folder (adjust if the website moves).
const WEB_DATA =
  process.env.WEBSITE_DATA_DIR ||
  'C:/Users/harsh/Downloads/nathmandirnashik-admin/nathmandirnashikweb/src/data'

const load = (file) => import(pathToFileURL(`${WEB_DATA}/${file}`).href)

async function main() {
  const [maharaj, temple, trust, events, donate, story] = await Promise.all([
    load('maharaj.js'),
    load('temple.js'),
    load('trust.js'),
    load('events.js'),
    load('donate.js'),
    load('story.js'),
  ])

  const sections = {
    maharaj: {
      intro: maharaj.MAHARAJ_INTRO,
      essence: maharaj.MAHARAJ_ESSENCE,
      biography: maharaj.MAHARAJ_BIOGRAPHY,
      timeline: maharaj.MAHARAJ_TIMELINE,
      teachings: maharaj.MAHARAJ_TEACHINGS,
      legacy: maharaj.MAHARAJ_LEGACY,
    },
    temple: {
      intro: temple.TEMPLE_INTRO,
      essence: temple.TEMPLE_ESSENCE,
      history: temple.TEMPLE_HISTORY,
      murti: temple.TEMPLE_MURTI,
      renovation: temple.TEMPLE_RENOVATION,
      facilities: temple.TEMPLE_FACILITIES,
      timings: temple.TEMPLE_TIMINGS,
      howToReach: temple.HOW_TO_REACH,
    },
    trust: {
      essence: trust.TRUST_ESSENCE,
      vision: trust.TRUST_VISION,
      mission: trust.TRUST_MISSION,
      founder: trust.FOUNDER,
      committees: trust.TRUSTEE_COMMITTEES,
      milestones: trust.TRUST_MILESTONES,
    },
    events: {
      festivals: events.FESTIVALS,
    },
    donate: {
      categories: donate.DONATION_CATEGORIES,
      suggestedAmounts: donate.SUGGESTED_AMOUNTS,
    },
    story: {
      chapters: story.STORY_CHAPTERS,
    },
  }

  for (const [key, data] of Object.entries(sections)) {
    const json = JSON.stringify(data)
    await prisma.siteSection.upsert({
      where: { key },
      update: { data: json },
      create: { key, data: json },
    })
    console.log(`  ✓ seeded "${key}" (${json.length} bytes)`)
  }

  console.log('✅ Website content sections seeded.')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
