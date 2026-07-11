// ── Mobile App API controller ─────────────────────────────────
// Node/Prisma port of the legacy API.php used by the mobile APK.
// The request params and the JSON response shape are kept IDENTICAL
// to the PHP so the existing app keeps working — only the base URL
// changes from ".../API.php" to ".../api/mobile".
//
// Differences from the PHP (intentional, safe):
//   • All SQL is parameterised (the PHP concatenated raw $_POST → SQL
//     injection). Behaviour is the same, injection holes are closed.
//   • Admin login checks the bcrypt hash in the `admins` table.
//   • The OTP SMS auth key lives in env (see src/lib/sms.js).
//
// User rows map to the Prisma `User` model but are echoed back with the
// PHP column names the app expects (mobile, active, Part_1, …).
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'
import { jsonSafe } from '../lib/helpers.js'
import { sendOtpSms } from '../lib/sms.js'

// Read a POST field (falls back to query string), matching PHP $_POST.
const field = (req, key) => {
  const v = req.body?.[key] ?? req.query?.[key]
  return v === undefined || v === null ? undefined : String(v)
}

// Shape a Prisma user as the PHP `user` row the app expects.
const toPhpUser = (u) => ({
  id: u.id,
  name: u.name,
  mobile: u.phone,
  email: u.email || '',
  city: u.city || '',
  address: u.address || '',
  otp: u.otp || '',
  active: u.status === 'active' ? 1 : 0,
  isPaid: u.isPaid ?? 0,
  donation: u.donation ?? 0,
  donation_audio: u.donationAudio ?? 0,
  amount: u.amount || '',
  Part_1: u.part1 ?? 0,
  Part_2: u.part2 ?? 0,
  token: u.token || '',
})

// ── loginuser ─ POST { mobile } → generate + send OTP ──────────
async function loginuser(req, res) {
  const mobile = field(req, 'mobile')
  if (!mobile) return res.json({ error: 'true', message: 'Check parameter' })

  const user = await prisma.user.findFirst({ where: { phone: mobile } })
  if (!user) return res.json({ error: 'true', message: 'Please Register First' })

  // Fixed OTP for the test account, random 4-digit otherwise.
  const otp = mobile === '1234567890' ? '1947' : String(Math.floor(1000 + Math.random() * 9000))

  await prisma.user.update({ where: { id: user.id }, data: { otp } })
  await sendOtpSms(mobile, otp) // returns false in dev; OTP is still sent back below

  // NOTE: the app relies on `otp` in the response (same as the old PHP).
  return res.json({ error: 'false', otp, message: 'OTP Sent Successfully' })
}

// ── verifyOTP ─ POST { otp, mobile, DID } → verify + open session ─
async function verifyOTP(req, res) {
  const otp = field(req, 'otp')
  const mobile = field(req, 'mobile')
  const did = field(req, 'DID')
  if (!otp || !mobile || !did) return res.json({ error: 'true', message: 'Check parameter' })

  const user = await prisma.user.findFirst({ where: { phone: mobile, otp } })
  if (!user) return res.json({ error: 'true', message: 'OTP Incorrect' })

  // Issue a JWT for this mobile session (long-lived — the app stays logged in).
  const token = jwt.sign(
    { id: user.id, mobile: user.phone, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.MOBILE_JWT_EXPIRES || '365d' }
  )

  // Clear OTP, mark active, persist the token, and bind this device.
  await prisma.user.update({ where: { id: user.id }, data: { otp: '', status: 'active' } })
  await prisma.$executeRawUnsafe(`UPDATE users SET token = ? WHERE id = ?`, token, user.id)
  await prisma.$executeRawUnsafe(`DELETE FROM login_user WHERE mobile = ?`, mobile)
  await prisma.$executeRawUnsafe(
    `INSERT INTO login_user (mobile, device_id) VALUES (?, ?)`,
    mobile, did
  )

  return res.json({
    token,
    data: toPhpUser({ ...user, otp: '', status: 'active', token }),
    error: 'false',
    message: 'Login Success',
  })
}

// ── receipts ─ POST { id } → successful payments for a user ────
async function receipts(req, res) {
  const id = field(req, 'id')
  if (!id) return res.json({ error: 'true', message: 'Check parameter' })

  const rows = await prisma.$queryRawUnsafe(
    `SELECT amount, status, created_at, updated_at, payment_type
     FROM user_payment WHERE user_id = ? AND status = '1'`,
    id
  )
  const data = jsonSafe(rows)
  if (!data.length) return res.json({ error: 'true', message: 'No data found' })
  return res.json({ error: 'false', message: 'Success', data })
}

// ── active_session ─ POST { id, mobile } → logout from all devices ─
async function active_session(req, res) {
  const id = field(req, 'id')
  const mobile = field(req, 'mobile')
  if (!id || !mobile) return res.json({ error: 'true', message: 'Check parameter' })

  try {
    await prisma.user.update({ where: { id: Number(id) }, data: { status: 'disabled' } })
    await prisma.$executeRawUnsafe(`DELETE FROM login_user WHERE mobile = ?`, mobile)
    return res.json({ error: 'false', message: 'Logout Success From All Devices' })
  } catch {
    return res.json({ error: 'true', message: 'Unable to logout' })
  }
}

// ── register ─ POST { name, email, mobile, city?, address? } ───
async function register(req, res) {
  const name = field(req, 'name')
  const email = field(req, 'email')
  const mobile = field(req, 'mobile')
  if (!name || !email || !mobile) return res.json({ error: 'true', message: 'Check parameter' })

  const exists = await prisma.user.findFirst({ where: { phone: mobile } })
  if (exists) return res.json({ error: 'true', message: 'Mobile Number Already exist' })

  await prisma.user.create({
    data: {
      name,
      phone: mobile,
      email,
      city: field(req, 'city') || '',
      address: field(req, 'address') || '',
    },
  })
  return res.json({ error: 'false', message: 'Register Successfully' })
}

// ── save_payment ─ POST { payment_request_id, payment_status, … } ─
async function save_payment(req, res) {
  const paymentRequestId = field(req, 'payment_request_id')
  const paymentStatus = field(req, 'payment_status')
  if (!paymentRequestId || !paymentStatus) return res.json({ error: 'true', message: 'Check parameter' })

  const userId = field(req, 'userID')
  const amount = field(req, 'amount') || ''

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO userpayment
        (userId, name, mobile, donation_for, amt, order_id, payment_request_id, payment_status)
       VALUES (?, ?, ?, '0', ?, ?, ?, ?)`,
      userId,
      field(req, 'name') || '',
      field(req, 'mobile') || '',
      amount,
      field(req, 'order_id') || '',
      paymentRequestId,
      paymentStatus
    )

    // Mirror the PHP user update: mark paid + set the purchased part(s).
    const data = { donationAudio: 1, isPaid: 1, amount }
    if (field(req, 'partOne') === '1') data.part1 = 1
    if (field(req, 'partTwo') === '1') data.part2 = 1
    await prisma.user.update({ where: { id: Number(userId) }, data })

    return res.json({ error: 'false', message: 'Payment Save Successfully' })
  } catch {
    return res.json({ error: 'true', message: 'Payment not Save' })
  }
}

// ── admin_login ─ POST { email, password } ─────────────────────
async function admin_login(req, res) {
  const email = field(req, 'email')
  const password = field(req, 'password')
  if (!email) return res.json({ error: 'true', message: 'Parameter not matched' })

  const admin = await prisma.admin.findUnique({ where: { email: email.trim().toLowerCase() } })
  if (admin && password && (await bcrypt.compare(password, admin.passwordHash))) {
    return res.json({ error: 'false', message: 'Login Success' })
  }
  return res.json({ error: 'true', message: 'Credentials not matched' })
}

// ── check_status ─ POST { mobile } → user row ──────────────────
async function check_status(req, res) {
  const mobile = field(req, 'mobile')
  if (!mobile) return res.json({ error: 'true', message: 'Check parameter' })

  const user = await prisma.user.findFirst({ where: { phone: mobile } })
  if (!user) return res.json({ error: 'true', message: 'Inactive User' })
  return res.json({ data: toPhpUser(user), error: 'false', message: 'Active User Save Successfully' })
}

// ── fetch_user / audio_donation_user ─ all users ───────────────
async function fetch_user(req, res) {
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' } })
  if (!users.length) return res.json({ error: 'true', message: 'Credentials not matched' })
  return res.json({ data: users.map(toPhpUser), error: 'false', message: 'User loaded' })
}

// ── update_session ─ POST { mobile, active } ───────────────────
async function update_session(req, res) {
  const mobile = field(req, 'mobile')
  const active = field(req, 'active')
  if (mobile === undefined || active === undefined) {
    return res.json({ error: 'true', message: 'Check parameter' })
  }

  try {
    await prisma.user.updateMany({
      where: { phone: mobile },
      data: { status: active === '1' ? 'active' : 'disabled' },
    })
    return res.json({ active, error: 'false', message: 'Updated Successfully' })
  } catch {
    return res.json({ error: 'true', message: 'Something went wrong' })
  }
}

// ── check_active_session ─ POST { mobile, DID } ────────────────
async function check_active_session(req, res) {
  const mobile = field(req, 'mobile')
  const did = field(req, 'DID')
  if (!mobile || !did) return res.json({ error: 'true', message: 'Check parameter' })

  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM login_user WHERE mobile = ? AND device_id = ?`,
    mobile, did
  )
  if (jsonSafe(rows).length > 0) {
    return res.json({ error: 'false', message: 'Login Success' })
  }
  return res.json({ error: 'true', message: 'Is Logged Out' })
}

// ── apicall → handler map (mirrors the PHP switch) ─────────────
export const handlers = {
  loginuser,
  verifyOTP,
  receipts,
  active_session,
  register,
  save_payment,
  admin_login,
  check_status,
  fetch_user,
  audio_donation_user: fetch_user, // identical to fetch_user in the PHP
  update_session,
  check_active_session,
}

// apicalls that do NOT need a Bearer token — they run before a token
// exists (login flow) or use their own credentials.
const PUBLIC_APICALLS = new Set(['loginuser', 'verifyOTP', 'register', 'admin_login'])

// Validate the mobile app's Bearer token: verify the JWT signature AND
// confirm it is still the token stored on the user row (verifyOTP saves it).
// This means a new login on another device invalidates old tokens.
async function authenticateMobile(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return { ok: false, message: 'Not authenticated. Please log in.' }

  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return { ok: false, message: 'Session expired or invalid. Please log in again.' }
  }

  const rows = jsonSafe(await prisma.$queryRawUnsafe(`SELECT token FROM users WHERE id = ?`, payload.id))
  if (!rows.length || rows[0].token !== token) {
    return { ok: false, message: 'Logged in on another device. Please log in again.' }
  }
  return { ok: true, payload }
}

// Single dispatcher entry point — reads ?apicall= like API.php did.
export async function dispatch(req, res) {
  const apicall = req.query.apicall || req.body?.apicall
  if (!apicall) {
    return res.json({ error: 'true', message: 'Invalid API Call' })
  }
  const handler = handlers[apicall]
  if (!handler) {
    return res.json({ error: 'true', message: 'Invalid Operation Called' })
  }

  // Protected apicalls require a valid Bearer token.
  if (!PUBLIC_APICALLS.has(apicall)) {
    const auth = await authenticateMobile(req)
    if (!auth.ok) return res.status(401).json({ error: 'true', message: auth.message })
    req.mobileUser = auth.payload // { id, mobile, name } — available to handlers
  }

  return handler(req, res)
}
