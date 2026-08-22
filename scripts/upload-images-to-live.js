// ─────────────────────────────────────────────────────────────
// Upload a folder of images to a running backend (live or local)
// and publish them as a gallery album.
//
// This does exactly what an admin does by hand in the panel —
// log in, upload each picture, create the album, attach the
// photos, publish — but for a whole folder in one go.
//
// The panel is the normal way to do this. This script is for the
// case where a folder of images has to land on a server in bulk,
// which is slow and error-prone to click through one at a time.
//
// Usage:
//   node scripts/upload-images-to-live.js \
//     --api https://api.nathmandir.sumago.ai/api \
//     --email admin@example.com --password "secret" \
//     --dir ./uploads/image \
//     --category maharaj --title "महाराजांची छायाचित्रे"
//
// Useful extras:
//   --album 18         add to an EXISTING album instead of creating one
//                      (with --title, the album is renamed too)
//   --title-file f.txt read the title from a UTF-8 file instead of --title.
//                      Use this for Marathi/Hindi titles: a Windows console
//                      mangles non-ASCII arguments, and the album ends up
//                      named in question marks.
//   --cover first.jpg  pick the cover by file name (default: first image)
//   --draft            create the album unpublished (default: published)
//   --dry-run          show what would happen, upload nothing
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'

// ── args ─────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    // Flags carry no value; everything else takes the next token.
    if (key === 'draft' || key === 'dry-run') out[key] = true
    else out[key] = argv[++i]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

const API = (args.api || process.env.API_URL || 'http://localhost:5000/api').replace(/\/+$/, '')
const EMAIL = args.email || process.env.ADMIN_EMAIL
const PASSWORD = args.password || process.env.ADMIN_PASSWORD
const DIR = args.dir
const CATEGORY = args.category
// A title from a file wins over --title, and is the only reliable way to pass
// Devanagari on Windows. Trailing newlines from an editor are dropped.
const TITLE = args['title-file'] ? readTitleFile(args['title-file']) : args.title ?? ''
// Distinguishes "no title given" from "title given as empty", which decides
// whether an existing album gets renamed.
const TITLE_GIVEN = args['title-file'] !== undefined || args.title !== undefined
const ALBUM_ID = args.album ? Number(args.album) : null
const PUBLISHED = !args.draft
const DRY = !!args['dry-run']

function bail(msg) {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}

// Hoisted, so it can be used by the TITLE constant above.
// Strips a leading BOM — Notepad writes one, and it would end up as an
// invisible first character of the album name.
function readTitleFile(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim()
  } catch (err) {
    bail(`Could not read --title-file ${file}: ${err.message}`)
  }
}

if (!EMAIL || !PASSWORD) bail('Need --email and --password (or ADMIN_EMAIL / ADMIN_PASSWORD).')
if (!DIR) bail('Need --dir <folder of images>.')
if (!ALBUM_ID && !CATEGORY) bail('Need --category <slug>, or --album <id> to use an existing album.')
if (!fs.existsSync(DIR)) bail(`Folder not found: ${DIR}`)

// ── which files ──────────────────────────────────────────────
// The same formats the backend accepts. SVG is deliberately left out:
// the server refuses it, so listing it here would only produce errors.
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)$/i

const files = fs
  .readdirSync(DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && IMAGE_EXT.test(e.name))
  .map((e) => e.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

if (!files.length) bail(`No images found in ${DIR}`)

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`

// ── http helpers ─────────────────────────────────────────────
let token = ''

async function api(method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    // An HTML reply means the request never reached Express — the proxy
    // answered it. Say that, rather than an "Unexpected token <" stack trace.
    throw new Error(`${method} ${url} → ${res.status}, and the reply was not JSON:\n${text.slice(0, 300)}`)
  }
  if (!res.ok) throw new Error(data.error || `${method} ${url} → ${res.status}`)
  return data
}

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  heic: 'image/heic', heif: 'image/heif',
}

async function uploadImage(name) {
  const full = path.join(DIR, name)
  const ext = path.extname(name).toLowerCase().replace('.', '')
  const form = new FormData()
  const blob = new Blob([fs.readFileSync(full)], { type: MIME[ext] || 'application/octet-stream' })
  form.append('file', blob, name)

  const res = await fetch(`${API}/uploads/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form, // no Content-Type — fetch sets the multipart boundary itself
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`upload ${name} → ${res.status}: ${text.slice(0, 300)}`)
  }
  if (!res.ok) throw new Error(data.error || `upload ${name} → ${res.status}`)
  return data // { url, name, size, mime, detected }
}

// ── run ──────────────────────────────────────────────────────
async function main() {
  const total = files.reduce((n, f) => n + fs.statSync(path.join(DIR, f)).size, 0)
  console.log(`\n📁 ${DIR}`)
  console.log(`   ${files.length} image(s), ${mb(total)} total`)
  console.log(`🌐 ${API}`)
  console.log(ALBUM_ID ? `📔 into existing album #${ALBUM_ID}` : `📔 new album "${TITLE}" in category "${CATEGORY}"`)
  console.log(`   published: ${PUBLISHED ? 'yes' : 'no (draft)'}\n`)

  if (DRY) {
    files.forEach((f, i) =>
      console.log(`   ${String(i + 1).padStart(3)}. ${f}  ${mb(fs.statSync(path.join(DIR, f)).size)}`)
    )
    console.log('\n🔎 dry run — nothing was uploaded.\n')
    return
  }

  // 1. log in
  const auth = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD })
  token = auth.token
  console.log(`🔑 signed in as ${auth.admin.email}`)

  // 2. album — reuse or create
  let albumId = ALBUM_ID
  if (albumId) {
    const { album } = await api('GET', `/albums/${albumId}`)
    console.log(`📔 using album #${album.id} (${album.photoCount} photo(s) already)`)
    // Renaming an existing album is opt-in: without --title the album keeps
    // whatever name it has, so a bulk add never quietly wipes one.
    if (TITLE_GIVEN && album.title !== TITLE) {
      await api('PATCH', `/albums/${albumId}`, { title: TITLE })
      console.log(`   renamed ${JSON.stringify(album.title)} → ${JSON.stringify(TITLE)}`)
    }
  } else {
    const { album } = await api('POST', '/albums', { title: TITLE, category: CATEGORY, published: PUBLISHED })
    albumId = album.id
    console.log(`📔 created album #${albumId}`)
  }

  // 3. upload + attach, one at a time
  // Sequential on purpose: a burst of parallel multipart uploads is the
  // quickest way to hit the proxy's limits, and the whole point here is
  // that every picture lands.
  const done = []
  const failed = []
  for (const [i, name] of files.entries()) {
    const label = `[${i + 1}/${files.length}] ${name}`
    try {
      const up = await uploadImage(name)
      await api('POST', `/albums/${albumId}/photos`, { url: up.url, caption: '' })
      done.push({ name, url: up.url })
      console.log(`   ✅ ${label} → ${up.url}`)
    } catch (err) {
      failed.push({ name, error: err.message })
      console.log(`   ❌ ${label} — ${err.message}`)
    }
  }

  // 4. cover + publish
  // The first photo becomes the cover on its own, but only when the album had
  // none. An existing album, or a chosen --cover, still has to be set here.
  const cover = args.cover ? done.find((d) => d.name === args.cover)?.url : done[0]?.url
  if (cover) {
    await api('PATCH', `/albums/${albumId}`, { cover, published: PUBLISHED })
    console.log(`\n🖼️  cover set → ${cover}`)
  }

  // 5. read it back the way the website and the app will see it
  const origin = API.replace(/\/api$/, '')
  const site = await fetch(`${origin}/api/public/gallery`).then((r) => r.json()).catch(() => null)
  const app = await fetch(`${origin}/api/mobile?apicall=gallery`).then((r) => r.json()).catch(() => null)

  console.log(`\n📊 uploaded ${done.length}/${files.length}`)
  if (failed.length) {
    console.log(`   ${failed.length} failed:`)
    failed.forEach((f) => console.log(`     - ${f.name}: ${f.error}`))
  }
  if (site) console.log(`🌐 website gallery now shows ${site.photos?.length ?? 0} photo(s) in ${site.albums?.length ?? 0} album(s)`)
  if (app) console.log(`📱 app gallery now shows ${app.photos?.length ?? 0} photo(s) in ${app.albums?.length ?? 0} album(s)`)
  if (done[0]) console.log(`\n🔗 open one to check: ${origin}${done[0].url}\n`)
}

main().catch((err) => bail(err.message))
