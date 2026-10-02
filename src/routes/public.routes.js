// ── Public website API ────────────────────────────────────────
// Read-only, no-auth endpoints consumed by the public website
// (nathmandirnashikweb). Only published content is exposed.
//
//   GET  /api/public/gallery?category=        — published albums + photos
//   GET  /api/public/library?category=        — published books + chapters
//   GET  /api/public/library/:id              — one published book
//   GET  /api/public/pages                    — published CMS pages
//   GET  /api/public/pages/:id                — one published page
//   GET  /api/public/notifications?limit=     — recent "all" announcements
//   POST /api/public/contact                  — submit a contact message
//
//   Legal policies (type: privacy | terms):
//   GET  /api/public/policies                 — both policies as JSON
//   GET  /api/public/policies/:type           — one policy as JSON
//   GET  /api/public/policies/web/:type       — one policy as a web page (EJS);
//                                               ?app=1 hides header/footer for a WebView
//   GET  /api/public/policies/web/all         — both on one web page
import { Router } from 'express'
import * as pub from '../controllers/public.controller.js'
import * as policies from '../controllers/publicPolicies.controller.js'

const router = Router()

router.get('/gallery', pub.gallery)
router.get('/library', pub.library)
router.get('/library/:id', pub.libraryBook)
router.get('/pages', pub.pages)
router.get('/pages/:id', pub.page)
router.get('/notifications', pub.notifications)
router.get('/sections', pub.sections)
router.get('/sections/:key', pub.section)
router.post('/contact', pub.submitContact)
// web/* first, so "web" is never read as a policy type.
router.get('/policies/web/all', policies.webAll)
router.get('/policies/web/:type', policies.webPage)
router.get('/policies', policies.list)
router.get('/policies/:type', policies.get)

export default router
