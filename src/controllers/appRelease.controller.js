// ── Android app release (APK) controller ──────────────────────
// The website's "Download APK" button. Every upload is kept as a row in
// app_releases (the history); exactly one row — or none — is live. Uploading
// a new APK makes it live straight away, and with none live the website shows
// no button at all.
//
//   Admin (requireAuth):
//     GET    /api/app-release           — { apk: live release | null, history: [...] }
//     POST   /api/app-release           — upload a new APK and make it live
//                                         (multipart, field "file", optional "version")
//     POST   /api/app-release/:id/live  — make an older release live again
//     DELETE /api/app-release           — take the live APK off the website
//                                         (row and file are kept)
//     DELETE /api/app-release/:id/file  — delete an old release's file to free
//                                         disk space (row is kept as history)
//
//   Public:
//     GET /api/public/app            — { apk: { version, size, uploadedAt, downloadUrl } | null }
//     GET /api/public/app/download   — the live APK file, as an attachment
//
// Files live in uploads/apk/ under unique names. Old files are kept, so an
// older version can be downloaded or made live again, until an admin deletes
// them.
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma.js'
import { UPLOADS_ROOT } from './uploads.controller.js'

const APK_DIR = path.join(UPLOADS_ROOT, 'apk')
fs.mkdirSync(APK_DIR, { recursive: true })

// APKs are much bigger than photos or audio. From .env, like the other caps.
const MAX_MB = (() => {
  const n = Number(process.env.UPLOAD_MAX_APK_MB)
  return Number.isFinite(n) && n > 0 ? n : 200
})()
const MAX_APK = MAX_MB * 1024 * 1024
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`

// Free text, but kept short and plain: it ends up in a file name.
const cleanVersion = (v) =>
  String(v || '')
    .trim()
    .replace(/[^0-9A-Za-z._-]/g, '')
    .slice(0, 30)

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, APK_DIR),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-nathmandir.apk`),
  }),
  limits: { fileSize: MAX_APK, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!/\.apk$/i.test(file.originalname || '')) {
      return cb(new Error('Only .apk files can be uploaded here.'))
    }
    cb(null, true)
  },
})

// ── Content check ────────────────────────────────────────────
// A name ending in .apk proves nothing. A real APK is a ZIP archive (starts
// with "PK\x03\x04") that contains an AndroidManifest.xml entry. The entry
// name is stored as plain bytes in the archive, so scanning for it is enough.
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const MANIFEST = Buffer.from('AndroidManifest.xml', 'latin1')

function isApk(filePath) {
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
    const head = Buffer.alloc(4)
    fs.readSync(fd, head, 0, 4, 0)
    if (!head.equals(ZIP_MAGIC)) return false

    // Read in 1 MB chunks, keeping a small overlap so a name split across
    // two chunks is still found.
    const chunk = Buffer.alloc(1024 * 1024)
    const overlap = MANIFEST.length - 1
    let pos = 0
    let carry = Buffer.alloc(0)
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos)
      if (n <= 0) return false
      const buf = Buffer.concat([carry, chunk.subarray(0, n)])
      if (buf.indexOf(MANIFEST) !== -1) return true
      carry = buf.subarray(Math.max(0, buf.length - overlap))
      pos += n
    }
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

// ── Helpers ──────────────────────────────────────────────────

// Full path of a stored file name, refusing anything outside uploads/apk/.
function apkPath(file) {
  if (!file) return null
  const full = path.resolve(APK_DIR, path.basename(String(file)))
  return full.startsWith(APK_DIR + path.sep) ? full : null
}

const fileExists = (file) => {
  const full = apkPath(file)
  return !!full && fs.existsSync(full)
}

const liveRelease = () => prisma.appRelease.findFirst({ where: { isLive: true }, orderBy: { id: 'desc' } })

// What the admin panel sees for one row.
const adminView = (r) =>
  r && {
    id: r.id,
    version: r.version || '',
    originalName: r.originalName,
    size: Number(r.size),
    isLive: r.isLive,
    uploadedBy: r.uploadedBy || '',
    uploadedAt: r.uploadedAt,
    fileDeletedAt: r.fileDeletedAt,
    // null once the file has been deleted (or has gone missing from disk).
    url: fileExists(r.file) ? `/uploads/apk/${r.file}` : null,
  }

async function adminState() {
  const rows = await prisma.appRelease.findMany({ orderBy: { id: 'desc' } })
  const history = rows.map(adminView)
  return { apk: history.find((r) => r.isLive) || null, history }
}

// ── Admin handlers ───────────────────────────────────────────

// GET /api/app-release
export async function get(req, res) {
  res.json(await adminState())
}

// POST /api/app-release
export function create(req, res) {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? `This APK is over the ${mb(MAX_APK)} upload limit.`
          : err.message
      return res.status(400).json({ error: msg })
    }
    if (!req.file) return res.status(400).json({ error: 'No file received (field name must be "file").' })

    const drop = () => fs.unlink(req.file.path, () => {})

    if (!isApk(req.file.path)) {
      drop()
      return res.status(400).json({
        error: `"${req.file.originalname}" is not a valid Android APK file.`,
      })
    }

    try {
      // One transaction, so the website never sees two live APKs or none.
      await prisma.$transaction([
        prisma.appRelease.updateMany({ where: { isLive: true }, data: { isLive: false } }),
        prisma.appRelease.create({
          data: {
            version: cleanVersion(req.body?.version),
            originalName: String(req.file.originalname).slice(0, 255),
            file: req.file.filename,
            size: BigInt(req.file.size),
            isLive: true,
            uploadedBy: (req.admin?.name || req.admin?.email || '').slice(0, 191) || null,
          },
        }),
      ])
      res.status(201).json(await adminState())
    } catch (e) {
      drop()
      console.error('APK save failed:', e)
      res.status(500).json({ error: 'Could not save the APK. Please try again.' })
    }
  })
}

// POST /api/app-release/:id/live
export async function makeLive(req, res) {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? await prisma.appRelease.findUnique({ where: { id } }) : null
  if (!row) return res.status(404).json({ error: 'That release was not found.' })
  if (!fileExists(row.file)) {
    return res.status(400).json({ error: 'The file for this version was deleted, so it cannot be made live.' })
  }
  await prisma.$transaction([
    prisma.appRelease.updateMany({ where: { isLive: true }, data: { isLive: false } }),
    prisma.appRelease.update({ where: { id }, data: { isLive: true } }),
  ])
  res.json(await adminState())
}

// DELETE /api/app-release
export async function unpublish(req, res) {
  await prisma.appRelease.updateMany({ where: { isLive: true }, data: { isLive: false } })
  res.json(await adminState())
}

// DELETE /api/app-release/:id/file
export async function removeFile(req, res) {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? await prisma.appRelease.findUnique({ where: { id } }) : null
  if (!row) return res.status(404).json({ error: 'That release was not found.' })
  if (row.isLive) {
    return res.status(400).json({ error: 'This version is live on the website. Remove it from the website first.' })
  }

  const full = apkPath(row.file)
  if (full) {
    try {
      fs.unlinkSync(full)
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error(`⚠️  could not delete APK ${row.file}: ${e.message}`)
        return res.status(500).json({ error: 'Could not delete the file. Please try again.' })
      }
    }
  }
  await prisma.appRelease.update({ where: { id }, data: { file: null, fileDeletedAt: new Date() } })
  res.json(await adminState())
}

// ── Public handlers ──────────────────────────────────────────

// GET /api/public/app
export async function publicInfo(req, res) {
  const r = await liveRelease()
  // A live row whose file has gone missing must not show a broken button.
  if (!r || !fileExists(r.file)) return res.json({ apk: null })
  res.json({
    apk: {
      version: r.version || '',
      size: Number(r.size),
      uploadedAt: r.uploadedAt,
      downloadUrl: '/api/public/app/download',
    },
  })
}

// GET /api/public/app/download
export async function download(req, res) {
  const r = await liveRelease()
  const full = r && apkPath(r.file)
  if (!full || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'The app is not available for download right now.' })
  }
  const name = `NathMandir${r.version ? `-v${r.version}` : ''}.apk`
  // Always the latest file — never let a browser or proxy keep an old one.
  res.set('Cache-Control', 'no-store')
  res.type('application/vnd.android.package-archive')
  res.download(full, name)
}
