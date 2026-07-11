// ── CMS Pages API (माहिती) ────────────────────────────────────
// GET    /api/pages        — list
// GET    /api/pages/:id    — one
// POST   /api/pages        — create
// PATCH  /api/pages/:id    — update
// DELETE /api/pages/:id    — delete
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as pages from '../controllers/pages.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', pages.list)
router.get('/:id', pages.get)
router.post('/', pages.create)
router.patch('/:id', pages.update)
router.delete('/:id', pages.remove)

export default router
