// ── Content hierarchy API ─────────────────────────────────────
// GET    /api/content-nodes?product=&parent=  — children + breadcrumb
// GET    /api/content-nodes/:id               — one section + breadcrumb
// POST   /api/content-nodes                   — add a section
// PATCH  /api/content-nodes/:id               — rename / reorder
// DELETE /api/content-nodes/:id               — remove an empty section
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as nodes from '../controllers/contentNodes.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', nodes.list)
router.get('/:id', nodes.get)
router.post('/', nodes.create)
router.patch('/:id', nodes.update)
router.delete('/:id', nodes.remove)

export default router
