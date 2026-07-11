// ── Content API ───────────────────────────────────────────────
// GET    /api/content?product=&query=  — list items (audio + text)
// POST   /api/content                  — add an item
// PATCH  /api/content/:id              — update (publish, lyrics, order…)
// DELETE /api/content/:id              — remove an item
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as content from '../controllers/content.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', content.list)
router.post('/', content.create)
router.patch('/:id', content.update)
router.delete('/:id', content.remove)

export default router
