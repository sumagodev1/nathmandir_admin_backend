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
import { Router } from 'express'
import * as pub from '../controllers/public.controller.js'

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

export default router
