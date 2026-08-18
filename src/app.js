// ── Express app ───────────────────────────────────────────────
// Builds the app and mounts all API routes. server.js starts it.
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import { prisma } from './lib/prisma.js'
import uploadsRoutes, { UPLOADS_ROOT } from './routes/uploads.routes.js'
import authRoutes from './routes/auth.routes.js'
import usersRoutes from './routes/users.routes.js'
import dashboardRoutes from './routes/dashboard.routes.js'
import productsRoutes from './routes/products.routes.js'
import contentRoutes from './routes/content.routes.js'
import contentNodesRoutes from './routes/contentNodes.routes.js'
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

// Request log. Express prints nothing by itself, so `pm2 logs` showed only the
// startup banner even while requests were arriving — there was no way to tell a
// request that never reached the process from one that reached it and failed.
// Registered as the very first middleware so nothing can be missed: a request
// rejected by CORS or by a route guard is still logged here.
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`)
  next()
})

// Behind nginx (TLS terminated at the proxy), honour X-Forwarded-Proto/Host so
// req.protocol is "https" and generated file URLs come back as
// https://api.nathmandir.sumago.ai/uploads/... instead of http://...
app.set('trust proxy', true)

// Allow the React admin panel to call this API. The method list is spelled out
// rather than left to the library default because every panel save is a PATCH,
// PUT or DELETE, and a preflight missing any of them fails the request outright
// with "Method PATCH is not allowed by Access-Control-Allow-Methods".
app.use(cors({
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// gzip every response above 1 KB. The admin list endpoints return sizeable
// JSON (users ≈170 KB, payments ≈275 KB, access ≈187 KB) and this cuts them by
// roughly 85–90%, which is where most of the "loading is slow" time went.
app.use(compression({ threshold: 1024 }))

// Parse JSON, keeping the raw bytes on req.rawBody so the Razorpay webhook
// can verify its signature (which is computed over the exact raw body).
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
app.use(express.urlencoded({ extended: true })) // parse form fields (mobile app / API.php style)

// Serve uploaded files (audio, images) — public, no auth (mobile app fetches directly).
// Uploaded files are written under a unique name and never rewritten in place,
// so browsers and the mobile app can cache them hard: repeat page views skip
// the download entirely instead of re-fetching every image and audio file.
app.use(
  '/uploads',
  express.static(UPLOADS_ROOT, {
    maxAge: '365d',
    immutable: true,
    etag: true,
    lastModified: true,
  })
)

// Public + admin GETs are revalidated with the ETag Express already generates:
// "no-cache" means the browser always asks, but an unchanged response comes
// back as a bodyless 304 instead of the full payload. That keeps the website
// and panel showing live data while making repeat loads near-instant.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') res.set('Cache-Control', 'no-cache')
  next()
})

// Health check — open http://localhost:5000/
app.get('/', async (req, res) => {
  try {
    const [{ db }] = await prisma.$queryRaw`SELECT DATABASE() AS db`
    res.json({ status: 'ok', message: `✅ Backend running + connected to ${db}` })
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
// Sections inside a Part (the generic content hierarchy)
app.use('/api/content-nodes', contentNodesRoutes)
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
