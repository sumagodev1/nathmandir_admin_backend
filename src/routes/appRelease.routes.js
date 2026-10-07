// ── Android app release (APK) API — admin only ────────────────
// GET    /api/app-release           — live APK + full upload history
// POST   /api/app-release           — upload a new APK (becomes live)
// POST   /api/app-release/:id/live  — make an older version live again
// DELETE /api/app-release           — take the live APK off the website
// DELETE /api/app-release/:id/file  — delete an old version's file (history kept)
// Public download lives on /api/public/app. See the controller.
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as release from '../controllers/appRelease.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', release.get)
router.post('/', release.create)
router.post('/:id/live', release.makeLive)
router.delete('/', release.unpublish)
router.delete('/:id/file', release.removeFile)

export default router
