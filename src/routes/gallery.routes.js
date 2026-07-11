// ── Photo Gallery API (Albums + Photos) ───────────────────────
// GET    /api/albums?category=            — list albums (with photo counts)
// GET    /api/albums/:id                  — one album with photos
// POST   /api/albums                      — create album
// PATCH  /api/albums/:id                  — update album (title, cover, published…)
// DELETE /api/albums/:id                  — delete album (photos cascade)
// POST   /api/albums/:id/photos           — add a photo { url, caption }
// DELETE /api/albums/:id/photos/:photoId  — remove a photo
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as gallery from '../controllers/gallery.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', gallery.list)
router.get('/:id', gallery.get)
router.post('/', gallery.create)
router.patch('/:id', gallery.update)
router.delete('/:id', gallery.remove)
router.post('/:id/photos', gallery.addPhoto)
router.delete('/:id/photos/:photoId', gallery.removePhoto)

export default router
