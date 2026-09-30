// ── Uploads API ───────────────────────────────────────────────
// POST /api/uploads/:kind  (kind = audio | image | cover)
//   cover = song/Part artwork, saved as a 512×512 WebP.
//   multipart/form-data, field name "file". See the controller for
//   storage config, size limits and the returned URL shape.
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { uploadFile, UPLOADS_ROOT } from '../controllers/uploads.controller.js'

// Re-exported so app.js can serve the uploads folder as static files.
export { UPLOADS_ROOT }

const router = Router()
router.use(requireAuth)

router.post('/:kind', uploadFile)

export default router
