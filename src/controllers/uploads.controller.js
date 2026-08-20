// ── Uploads controller ────────────────────────────────────────
// Multer setup + handler for /api/uploads/:kind (kind = audio | image).
//   multipart/form-data, field name "file".
//   Saves the file to Backend/uploads/<kind>/ and returns a
//   relative URL like "/uploads/audio/1699999999-track.mp3".
//   The relative path is stored in the DB (portable across domains);
//   the frontend/mobile app prefixes it with the API origin.
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Backend/uploads/  (two levels up from src/controllers/)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads')

// A browser reports the MIME type from the OPERATING SYSTEM's registry, not
// from the file's contents — and Windows registers .mp3 as "video/mpeg" on many
// machines, so a perfectly ordinary MP3 arrives labelled as video and used to be
// rejected outright. The same happens with "audio/mp3", "audio/x-m4a" and, for
// files copied off phones or cloud drives, "application/octet-stream".
//
// So a file is accepted when EITHER its reported MIME type matches OR its
// extension is on the list below. That is safe here because uploads are
// admin-only, and express.static serves files by EXTENSION — a file saved as
// .mp3 is served as audio/mpeg whatever its bytes contain.
// Size caps come from .env so they can be changed without a deploy — and so
// they can differ per environment. A missing or unreadable value falls back to
// the number below rather than to zero, which would refuse every upload.
const envMb = (key, fallback) => {
  const n = Number(process.env[key])
  return (Number.isFinite(n) && n > 0 ? n : fallback) * 1024 * 1024
}
const MAX_AUDIO = envMb('UPLOAD_MAX_AUDIO_MB', 50)
const MAX_IMAGE = envMb('UPLOAD_MAX_IMAGE_MB', 25)
// The hard ceiling multer enforces while streaming, before the per-kind check.
// Whichever kind is largest, or a 50 MB audio file would be cut off by a
// 25 MB image limit.
const MAX_ANY = Math.max(MAX_AUDIO, MAX_IMAGE)

const KINDS = {
  audio: {
    dir: 'audio',
    mime: /^audio\//,
    ext: /\.(mp3|mpga|m4a|m4b|aac|wav|wave|ogg|oga|opus|flac|weba|wma|aif|aiff)$/i,
    label: 'MP3, M4A, AAC, WAV, OGG, OPUS or FLAC',
    limit: MAX_AUDIO,
  },
  image: {
    dir: 'image',
    mime: /^image\//,
    ext: /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)$/i,
    label: 'JPG, PNG, GIF, WEBP, AVIF or HEIC',
    // Defaults to 25 MB: a photo straight off a phone or DSLR is routinely
    // 15-20 MB. Do still compress before uploading — every one of these is
    // downloaded in full by every devotee who opens the gallery.
    limit: MAX_IMAGE,
  },
}

// SVG is an image the browser will happily execute scripts inside. Serving one
// back from this origin would be stored XSS, so it is refused no matter how it
// is labelled — every other raster format above covers the real use cases.
const BLOCKED = /\.(svg|svgz|html?|xhtml|js|mjs|php|phtml)$/i

// ── Content sniffing ─────────────────────────────────────────
// Neither the MIME type nor the file name can be trusted: Windows calls .mp3
// "video/mpeg", cloud drives send "application/octet-stream", and real files
// turn up double-extensioned like "audio.mp3.mpeg". So after the upload lands
// we read its first bytes and identify it by its actual signature.
//
// This is both friendlier (an MP3 is accepted however it is named) and SAFER
// than trusting a name, because the bytes have to genuinely be what the
// endpoint expects.
const SIGNATURES = [
  // ── audio ──
  { kind: 'audio', ext: 'mp3',  test: (b) => b.slice(0, 3).toString('latin1') === 'ID3' },
  // MPEG audio frame sync: 11 set bits.
  { kind: 'audio', ext: 'mp3',  test: (b) => b[0] === 0xff && (b[1] & 0xe0) === 0xe0 },
  { kind: 'audio', ext: 'flac', test: (b) => b.slice(0, 4).toString('latin1') === 'fLaC' },
  { kind: 'audio', ext: 'ogg',  test: (b) => b.slice(0, 4).toString('latin1') === 'OggS' },
  { kind: 'audio', ext: 'wav',  test: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WAVE' },
  { kind: 'audio', ext: 'aiff', test: (b) => b.slice(0, 4).toString('latin1') === 'FORM' && b.slice(8, 12).toString('latin1') === 'AIFF' },
  { kind: 'audio', ext: 'wma',  test: (b) => b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75 },
  // ISO-BMFF: brand decides whether it is audio (M4A) or an image (HEIC/AVIF).
  { kind: 'audio', ext: 'm4a',  test: (b) => b.slice(4, 8).toString('latin1') === 'ftyp' && /^(M4A|M4B|mp42|isom|dash)/.test(b.slice(8, 12).toString('latin1')) },

  // ── image ──
  { kind: 'image', ext: 'jpg',  test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { kind: 'image', ext: 'png',  test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { kind: 'image', ext: 'gif',  test: (b) => b.slice(0, 4).toString('latin1') === 'GIF8' },
  { kind: 'image', ext: 'webp', test: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
  { kind: 'image', ext: 'bmp',  test: (b) => b[0] === 0x42 && b[1] === 0x4d },
  { kind: 'image', ext: 'avif', test: (b) => b.slice(4, 8).toString('latin1') === 'ftyp' && /^(avif|avis)/.test(b.slice(8, 12).toString('latin1')) },
  { kind: 'image', ext: 'heic', test: (b) => b.slice(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|mif1)/.test(b.slice(8, 12).toString('latin1')) },
]

// → { kind, ext } when recognised, otherwise null.
function sniff(filePath) {
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(16)
    fs.readSync(fd, buf, 0, 16, 0)
    return SIGNATURES.find((s) => { try { return s.test(buf) } catch { return false } }) || null
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

// Make sure the folders exist up front.
for (const k of Object.values(KINDS)) {
  fs.mkdirSync(path.join(UPLOADS_ROOT, k.dir), { recursive: true })
}

// Turn "Sukhkarta Dukhharta.mp3" → "sukhkarta-dukhharta" (safe slug).
const slugify = (name) =>
  name
    .replace(/\.[^.]+$/, '')            // drop extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')        // non-alphanumerics → dash
    .replace(/^-+|-+$/g, '')            // trim dashes
    .slice(0, 40) || 'file'

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const cfg = KINDS[req.params.kind]
    if (!cfg) return cb(new Error('Invalid upload kind.'))
    cb(null, path.join(UPLOADS_ROOT, cfg.dir))
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 8)
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
    cb(null, `${unique}-${slugify(file.originalname)}${ext}`)
  },
})

// Bytes -> "15.5 MB", so every size in an error is one the admin can compare
// against the file on their disk.
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`

const upload = multer({
  storage,
  limits: { fileSize: MAX_ANY }, // hard ceiling; per-kind checked below
  fileFilter: (req, file, cb) => {
    const cfg = KINDS[req.params.kind]
    if (!cfg) return cb(new Error('Invalid upload kind.'))

    const name = file.originalname || ''

    // Refused outright — these can execute in a browser on this origin.
    if (BLOCKED.test(name) || /svg/i.test(file.mimetype)) {
      return cb(new Error('That file type is not allowed for security reasons.'))
    }

    // Everything else is let through to disk so its CONTENT can be checked in
    // the handler below. Judging by name/MIME here would reject real files that
    // are merely mislabelled ("audio.mp3.mpeg" reported as video/mpeg); anything
    // that turns out not to be audio/an image is deleted immediately.
    return cb(null, true)
  },
})

// POST /api/uploads/:kind  → { url, name, size, mime }
export function uploadFile(req, res) {
  const cfg = KINDS[req.params.kind]
  if (!cfg) return res.status(400).json({ error: 'Invalid upload kind. Use audio or image.' })

  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? `That file is over the ${mb(MAX_ANY)} upload limit.`
          : err.message
      return res.status(400).json({ error: msg })
    }
    if (!req.file) return res.status(400).json({ error: 'No file received (field name must be "file").' })

    const drop = () => fs.unlink(req.file.path, () => {})

    if (req.file.size > cfg.limit) {
      drop()
      // Both numbers, or the admin is left guessing how much to shrink it by.
      return res.status(400).json({
        error: `This ${req.params.kind} is ${mb(req.file.size)}. The limit is ${mb(cfg.limit)} — please compress it and try again.`,
      })
    }

    // ── Verify by content, not by name ──
    const found = sniff(req.file.path)

    if (found && found.kind !== req.params.kind) {
      drop()
      return res.status(400).json({
        error: `That file is ${found.ext.toUpperCase()}, which isn't ${req.params.kind}. Accepted: ${cfg.label}.`,
      })
    }

    // Unrecognised signature: fall back to the name/MIME allow-list rather than
    // rejecting a valid-but-exotic format outright.
    if (!found && !(cfg.mime.test(req.file.mimetype) || cfg.ext.test(req.file.originalname || ''))) {
      drop()
      return res.status(400).json({
        error: `"${req.file.originalname}" doesn't look like ${req.params.kind}. Accepted: ${cfg.label}.`,
      })
    }

    // Normalise the extension to what the bytes actually are. This matters:
    // "audio.mp3.mpeg" would otherwise be stored as .mpeg and served as
    // video/mpeg, and the <audio> player would refuse to play it.
    let filename = req.file.filename
    if (found) {
      const current = path.extname(filename).toLowerCase().replace('.', '')
      const want = found.ext
      const equivalent = (current === 'jpeg' && want === 'jpg') || (current === 'oga' && want === 'ogg')
      if (current !== want && !equivalent) {
        const renamed = `${filename.replace(/\.[^.]*$/, '')}.${want}`
        try {
          fs.renameSync(req.file.path, path.join(path.dirname(req.file.path), renamed))
          filename = renamed
        } catch {
          /* keep the original name if the rename fails — the upload still works */
        }
      }
    }

    const url = `/uploads/${cfg.dir}/${filename}`
    res.status(201).json({
      url,
      name: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
      detected: found ? found.ext : null,
    })
  })
}
