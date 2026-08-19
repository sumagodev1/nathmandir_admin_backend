// ── Gallery category master API ───────────────────────────────
// GET    /api/gallery-categories      — list (with album counts)
// POST   /api/gallery-categories      — create { name, slug?, sortOrder?, published? }
// PATCH  /api/gallery-categories/:id  — rename / reorder / publish
// DELETE /api/gallery-categories/:id  — remove (refused while albums use it)
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as categories from '../controllers/galleryCategories.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', categories.list)
router.post('/', categories.create)
router.patch('/:id', categories.update)
router.delete('/:id', categories.remove)

export default router
