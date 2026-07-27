// ── Express app ───────────────────────────────────────────────
// Builds the app and mounts all API routes. server.js starts it.
import express from 'express'
import cors from 'cors'
import { prisma } from './lib/prisma.js'
import uploadsRoutes, { UPLOADS_ROOT } from './routes/uploads.routes.js'
import authRoutes from './routes/auth.routes.js'
import usersRoutes from './routes/users.routes.js'
import dashboardRoutes from './routes/dashboard.routes.js'
import productsRoutes from './routes/products.routes.js'
import contentRoutes from './routes/content.routes.js'
import salesRoutes from './routes/sales.routes.js'
import accessRoutes from './routes/access.routes.js'
import libraryRoutes from './routes/library.routes.js'
import galleryRoutes from './routes/gallery.routes.js'
import pagesRoutes from './routes/pages.routes.js'
import settingsRoutes from './routes/settings.routes.js'
import notificationsRoutes from './routes/notifications.routes.js'
import paymentsRoutes from './routes/payments.routes.js'
import donationsRoutes from './routes/donations.routes.js'
import contactsRoutes from './routes/contacts.routes.js'
import loginsRoutes from './routes/logins.routes.js'
import mobileRoutes from './routes/mobile.routes.js'
import checkoutRoutes from './routes/checkout.routes.js'
import donateRoutes from './routes/donate.routes.js'
import publicRoutes from './routes/public.routes.js'
import sectionsRoutes from './routes/sections.routes.js'

export const app = express()

// Behind nginx (TLS terminated at the proxy), honour X-Forwarded-Proto/Host so
// req.protocol is "https" and generated file URLs come back as
// https://api.nathmandir.sumago.ai/uploads/... instead of http://...
app.set('trust proxy', true)

app.use(cors())         // allow the React admin panel to call this API
// Parse JSON, keeping the raw bytes on req.rawBody so the Razorpay webhook
// can verify its signature (which is computed over the exact raw body).
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
app.use(express.urlencoded({ extended: true })) // parse form fields (mobile app / API.php style)

// Serve uploaded files (audio, images) — public, no auth (mobile app fetches directly)
app.use('/uploads', express.static(UPLOADS_ROOT))

// Health check — open http://localhost:5000/
app.get('/', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', message: '✅ Backend running + connected to shreenath_admin' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: '❌ Database unreachable', detail: err.message })
  }
})

// API routes
app.use('/api/auth', authRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/products', productsRoutes)
app.use('/api/content', contentRoutes)
app.use('/api/sales', salesRoutes)
app.use('/api/access', accessRoutes)
app.use('/api/books', libraryRoutes)
app.use('/api/albums', galleryRoutes)
app.use('/api/pages', pagesRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/notifications', notificationsRoutes)
app.use('/api/payments', paymentsRoutes)
app.use('/api/donations', donationsRoutes)
app.use('/api/contacts', contactsRoutes)
app.use('/api/logins', loginsRoutes)
app.use('/api/sections', sectionsRoutes)
app.use('/api/uploads', uploadsRoutes)

// Public mobile-app API (drop-in replacement for the legacy API.php)
app.use('/api/mobile', mobileRoutes)

// Website payment flow (OTP → Razorpay → unlock module flags)
app.use('/api/checkout', checkoutRoutes)

// Website donation flow (Razorpay → record gift in donation table)
app.use('/api/donate', donateRoutes)

// Public website API (read-only published content + contact form)
app.use('/api/public', publicRoutes)

// 404 for unknown API paths
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` })
})

// Central error handler (catches thrown/async errors)
app.use((err, req, res, next) => {
  console.error('API error:', err)
  res.status(500).json({ error: 'Something went wrong on the server.' })
})
