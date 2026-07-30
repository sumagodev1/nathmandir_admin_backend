// ── Auth controller ───────────────────────────────────────────
// Handlers for /api/auth (login, current admin, logout, change password).
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'

// POST /api/auth/login   — email + password → JWT token
export async function login(req, res) {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }

  const admin = await prisma.admin.findUnique({
    where: { email: String(email).trim().toLowerCase() },
  })
  // Same message whether email or password is wrong (don't leak which).
  if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' })
  }

  const token = jwt.sign(
    { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )

  res.json({
    token,
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  })
}

// GET /api/auth/me      — current admin (from token)
export async function me(req, res) {
  const admin = await prisma.admin.findUnique({
    where: { id: req.admin.id },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!admin) return res.status(404).json({ error: 'Admin not found.' })
  res.json({ admin })
}

// POST /api/auth/logout — stateless; client just discards the token
export function logout(req, res) {
  // JWTs are stateless — logout is handled client-side by discarding the token.
  res.json({ ok: true })
}

// PATCH /api/auth/profile  { name?, email? }  — update the signed-in admin
export async function updateProfile(req, res) {
  const { name, email } = req.body || {}

  const data = {}
  if (name !== undefined) {
    const trimmed = String(name).trim()
    if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty.' })
    data.name = trimmed
  }
  if (email !== undefined) {
    const normalized = String(email).trim().toLowerCase()
    // Same shape check the login form relies on — one @, no spaces.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return res.status(400).json({ error: 'Enter a valid email address.' })
    }
    // email is @unique — check first so we can return a readable message
    // instead of a Prisma constraint error.
    const clash = await prisma.admin.findUnique({ where: { email: normalized } })
    if (clash && clash.id !== req.admin.id) {
      return res.status(409).json({ error: 'That email is already used by another admin.' })
    }
    data.email = normalized
  }

  if (!Object.keys(data).length) {
    return res.status(400).json({ error: 'Nothing to update.' })
  }

  const admin = await prisma.admin.update({
    where: { id: req.admin.id },
    data,
    select: { id: true, name: true, email: true, role: true },
  })

  // The old JWT carries the previous name/email in its payload. Every guarded
  // route resolves the admin by `id` (and /auth/me re-reads the row), so the
  // stale copy is harmless — but re-issuing keeps the token honest and means
  // the client never has to log in again after changing its email.
  const token = jwt.sign(
    { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )

  res.json({ admin, token })
}

// POST /api/auth/change-password  { currentPassword, newPassword }
export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {}
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required.' })
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' })
  }

  const admin = await prisma.admin.findUnique({ where: { id: req.admin.id } })
  if (!admin || !(await bcrypt.compare(currentPassword, admin.passwordHash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' })
  }

  const passwordHash = await bcrypt.hash(newPassword, 10)
  await prisma.admin.update({ where: { id: admin.id }, data: { passwordHash } })
  res.json({ ok: true })
}
