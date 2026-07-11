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
