// ── Uploads API ───────────────────────────────────────────────
// POST /api/uploads/:kind  (kind = audio | image)
//   multipart/form-data, field name "file".
//   Saves the file to Backend/uploads/<kind>/ and returns a
//   relative URL like "/uploads/audio/1699999999-track.mp3".
//   The relative path is stored in the DB (portable across domains);
//   the frontend/mobile app prefixes it with the API origin.
import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// Backend/uploads/  (two levels up from src/routes/)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads')

const KINDS = {
  audio: { dir: 'audio', mime: /^audio\//, limit: 50 * 1024 * 1024 }, // 50 MB
  image: { dir: 'image', mime: /^image\//, limit: 10 * 1024 * 1024 }, // 10 MB
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

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // hard ceiling; per-kind checked below
  fileFilter: (req, file, cb) => {
    const cfg = KINDS[req.params.kind]
    if (!cfg) return cb(new Error('Invalid upload kind.'))
    if (!cfg.mime.test(file.mimetype)) {
      return cb(new Error(`Expected ${req.params.kind} file, got "${file.mimetype}".`))
    }
    cb(null, true)
  },
})

router.use(requireAuth)

// POST /api/uploads/:kind  → { url, name, size, mime }
router.post('/:kind', (req, res) => {
  const cfg = KINDS[req.params.kind]
  if (!cfg) return res.status(400).json({ error: 'Invalid upload kind. Use audio or image.' })

  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message
      return res.status(400).json({ error: msg })
    }
    if (!req.file) return res.status(400).json({ error: 'No file received (field name must be "file").' })
    if (req.file.size > cfg.limit) {
      fs.unlink(req.file.path, () => {})
      return res.status(400).json({ error: 'File is too large for this type.' })
    }

    const url = `/uploads/${cfg.dir}/${req.file.filename}`
    res.status(201).json({
      url,
      name: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
    })
  })
})

export default router
