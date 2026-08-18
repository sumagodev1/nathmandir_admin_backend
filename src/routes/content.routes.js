// ── Content API ───────────────────────────────────────────────
// GET    /api/content?product=&query=  — list items (audio + text)
// POST   /api/content                  — add an item
// POST   /api/content/import/:dataset  — bulk-load a bundled track list
// PATCH  /api/content/:id              — update (publish, lyrics, order…)
// DELETE /api/content/:id              — move an item to the bin
// DELETE /api/content/:id?hard=1       — delete it for good
// POST   /api/content/:id/restore      — bring it back out of the bin
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as content from '../controllers/content.controller.js'

const router = Router()
router.use(requireAuth)

// Declared before '/:id' so "import" is never read as an id.
router.post('/import/:dataset', content.importDataset)

router.get('/', content.list)
router.post('/', content.create)
router.patch('/:id', content.update)
router.delete('/:id', content.remove)
router.post('/:id/restore', content.restore)

export default router
