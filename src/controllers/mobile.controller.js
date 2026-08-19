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
import { productMaps, resolveProductId } from '../lib/products.js'
import { groupSchedule } from '../lib/contentSchedule.js'
import { sectionMap, sectionPath, subtreeIds } from '../lib/sectionTrail.js'
import { jsonSafe, ymd, paginate } from '../lib/helpers.js'
import { sendOtpSms } from '../lib/sms.js'
import { STATUS, sendOk, sendFail } from '../lib/statusCodes.js'

// Read a POST field (falls back to query string), matching PHP $_POST.
const field = (req, key) => {
  const v = req.body?.[key] ?? req.query?.[key]
  return v === undefined || v === null ? undefined : String(v)
}

// Optional hard override for the public origin (e.g. https://api.nathmandir.sumago.ai).
// Set PUBLIC_BASE_URL in production to guarantee https file URLs even if the reverse
// proxy doesn't forward X-Forwarded-Proto. When unset we derive it from the request
// (with `trust proxy` enabled, that already resolves to https behind nginx).
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')

// Turn a stored file reference into a full URL the app can play directly.
// Relative "/uploads/…" paths get this server's origin; full http(s) URLs pass through.
const absUrl = (req, ref) => {
  if (!ref) return null
  if (/^https?:\/\//i.test(ref)) return ref
  const base = PUBLIC_BASE || `${req.protocol}://${req.get('host')}`
  return `${base}${ref.startsWith('/') ? '' : '/'}${ref}`
}

// Returns the Set of product IDs the user currently owns.
// Reads only from user_access (the single source of truth after migration).
// Expired rows (expiresOn in the past) are excluded — only active grants count.
async function getOwnedProductIds(userId) {
  const now = new Date()
  const access = await prisma.userAccess.findMany({
    where: {
      userId,
      OR: [
        { expiresOn: null },        // permanent (purchases + perm grants)
        { expiresOn: { gt: now } }, // not yet expired (7d / 15d grants still active)
      ],
    },
    select: { productId: true },
  })
  return new Set(access.map((a) => a.productId))
}

// Same as above but keyed by the PUBLIC CODE, for the payloads the deployed
// APK reads (Part_1/Part_2 flags, module `code` fields).
async function getOwnedProductCodes(userId) {
  const ids = await getOwnedProductIds(userId)
  const { codeById } = await productMaps()
  return new Set([...ids].map((id) => codeById.get(id)).filter(Boolean))
}

// Shape a Prisma user (with access included) as the PHP `user` row the app expects.
// Part_1, Part_2, upasanaPaid, nityaniyamPaid are computed from user_access rows
// (not from flag columns) so they remain accurate for newly purchased products.
// `codeById` maps numeric product id -> public code; pass the map from
// productMaps() so the legacy Part_1/Part_2 flags stay correct.
const toPhpUser = (u, codeById = new Map()) => {
  const now = new Date()
  const owned = new Set(
    (u.access || [])
      .filter((a) => !a.expiresOn || a.expiresOn > now)
      .map((a) => codeById.get(a.productId))
  )
  return {
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
    Part_1: owned.has('gita1') ? 1 : 0,
    Part_2: owned.has('gita2') ? 1 : 0,
    upasanaPaid: owned.has('upasana') ? 1 : 0,
    nityaniyamPaid: owned.has('nithya') ? 1 : 0,
    token: u.token || '',
  }
}

// ── loginuser ─ POST { mobile } → generate + send OTP ──────────
async function loginuser(req, res) {
  const mobile = field(req, 'mobile')
  if (!mobile) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  const user = await prisma.user.findFirst({ where: { phone: mobile } })
  if (!user) return sendFail(res, 'Please Register First', STATUS.NOT_FOUND)

  // Turned away here as well as at verifyOTP, so a disabled account does not
  // burn an SMS on an OTP it can never use.
  if (user.status === 'disabled') {
    return sendFail(res, 'This account has been disabled. Please contact the temple.', STATUS.UNAUTHORIZED)
  }

  // Fixed OTP for the test account, random 4-digit otherwise.
  const otp = mobile === '1234567890' ? '1947' : String(Math.floor(1000 + Math.random() * 9000))

  await prisma.user.update({ where: { id: user.id }, data: { otp } })
  await sendOtpSms(mobile, otp) // returns false in dev; OTP is still sent back below

  // NOTE: the app relies on `otp` in the response (same as the old PHP).
  return sendOk(res, 'OTP Sent Successfully', { otp })
}

// ── verifyOTP ─ POST { otp, mobile, DID? } → verify + open session ─
// DID (device id) is OPTIONAL: when supplied, this device is bound to the
// account (previous devices are unbound). When omitted, the login still
// succeeds and a token is issued, but no device row is registered — so
// check_active_session will report "Is Logged Out" for that session.
// The mobile app always sends DID, so its behaviour is unchanged.
async function verifyOTP(req, res) {
  const otp = field(req, 'otp')
  const mobile = field(req, 'mobile')
  const did = field(req, 'DID')
  if (!otp || !mobile) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  const user = await prisma.user.findFirst({ where: { phone: mobile, otp } })
  if (!user) return sendFail(res, 'OTP Incorrect', STATUS.UNAUTHORIZED)

  // `status` is the admin's enable/disable switch. Until now nothing checked
  // it, so "disable this user" in the panel changed a column and stopped
  // nothing — the person kept full access. This is where it finally bites.
  if (user.status === 'disabled') {
    return sendFail(res, 'This account has been disabled. Please contact the temple.', STATUS.UNAUTHORIZED)
  }

  // Issue a JWT for this mobile session (long-lived — the app stays logged in).
  const token = jwt.sign(
    { id: user.id, mobile: user.phone, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.MOBILE_JWT_EXPIRES || '365d' }
  )

  // Clear the OTP and stamp the login. `status` is deliberately NOT written
  // here any more: forcing it to 'active' on every login would quietly undo an
  // admin's disable the moment the person logged in again.
  //
  // last_login was never written by anything, which is why the dashboard's
  // "Inactive (7 days)" card counted every user who ever registered.
  await prisma.user.update({
    where: { id: user.id },
    data: { otp: '', lastLogin: new Date() },
  })
  await prisma.$executeRawUnsafe(`UPDATE users SET token = ? WHERE id = ?`, token, user.id)

  // Bind this device only when a DID was supplied (it is optional).
  if (did) {
    await prisma.$executeRawUnsafe(`DELETE FROM login_user WHERE mobile = ?`, mobile)
    await prisma.$executeRawUnsafe(
      `INSERT INTO login_user (mobile, device_id) VALUES (?, ?)`,
      mobile, did
    )
  }

  // Reload with access so toPhpUser can compute Part_1/Part_2/etc. from user_access.
  const freshUser = await prisma.user.findUnique({ where: { id: user.id }, include: { access: true } })
  return sendOk(res, 'Login Success', {
    token,
    // The login just succeeded, so this account is enabled by definition — a
    // disabled one was turned away above. Reporting the row's real status
    // keeps the response honest instead of hard-coding 'active'.
    data: toPhpUser({ ...freshUser, otp: '', token }, (await productMaps()).codeById),
  })
}

// ── receipts ─ POST { id } → successful payments for a user ────
async function receipts(req, res) {
  const id = field(req, 'id')
  if (!id) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  const rows = await prisma.$queryRawUnsafe(
    `SELECT amount, status, created_at, updated_at, payment_type
     FROM user_payment WHERE user_id = ? AND status = '1'`,
    id
  )
  const data = jsonSafe(rows)
  if (!data.length) return sendFail(res, 'No data found', STATUS.NOT_FOUND)
  return sendOk(res, 'Success', { data })
}

// ── active_session ─ POST { id, mobile } → logout from all devices ─
async function active_session(req, res) {
  const id = field(req, 'id')
  const mobile = field(req, 'mobile')
  if (!id || !mobile) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  try {
    // Deleting the device rows IS the logout — check_active_session reads
    // login_user, nothing else. This used to also set status='disabled', which
    // meant every logout looked identical to an admin ban: it is why 81
    // accounts sat "disabled" and why the dashboard's Active Users count kept
    // drifting down on its own. Now that a disabled account is actually turned
    // away at login, writing it here would lock people out of their own books.
    await prisma.$executeRawUnsafe(`DELETE FROM login_user WHERE mobile = ?`, mobile)
    // Drop the stored JWT too, or the old token keeps working after "logout".
    await prisma.$executeRawUnsafe(`UPDATE users SET token = NULL WHERE id = ?`, Number(id))
    return sendOk(res, 'Logout Success From All Devices')
  } catch {
    return sendFail(res, 'Unable to logout', STATUS.SERVER_ERROR)
  }
}

// ── register ─ POST { name, email, mobile, city?, address? } ───
async function register(req, res) {
  const name = field(req, 'name')
  const email = field(req, 'email')
  const mobile = field(req, 'mobile')
  if (!name || !email || !mobile) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  const exists = await prisma.user.findFirst({ where: { phone: mobile } })
  if (exists) return sendFail(res, 'Mobile Number Already exist', STATUS.CONFLICT)

  await prisma.user.create({
    data: {
      name,
      phone: mobile,
      email,
      city: field(req, 'city') || '',
      address: field(req, 'address') || '',
    },
  })
  return sendOk(res, 'Register Successfully', {}, STATUS.CREATED)
}

// ── save_payment ─ POST { payment_request_id, payment_status, … } ─
async function save_payment(req, res) {
  const paymentRequestId = field(req, 'payment_request_id')
  const paymentStatus = field(req, 'payment_status')
  if (!paymentRequestId || !paymentStatus) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

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

    // Mark the user as paid (general flag — not product-specific).
    await prisma.user.update({ where: { id: Number(userId) }, data: { donationAudio: 1, isPaid: 1, amount } })

    // Write product ownership to user_access (the single source of truth).
    // Never write to flag columns — user_access is product-agnostic and scalable.
    const accessCodes = []
    if (field(req, 'partOne') === '1') accessCodes.push('gita1')
    if (field(req, 'partTwo') === '1') accessCodes.push('gita2')
    for (const code of accessCodes) {
      const productId = await resolveProductId(code)
      if (productId === null) continue // module removed — nothing to unlock
      await prisma.userAccess.upsert({
        where: { userId_productId: { userId: Number(userId), productId } },
        update: { source: 'purchased', expiresOn: null },
        create: { userId: Number(userId), productId, source: 'purchased' },
      })
    }

    return sendOk(res, 'Payment Save Successfully', {}, STATUS.CREATED)
  } catch {
    return sendFail(res, 'Payment not Save', STATUS.SERVER_ERROR)
  }
}

// ── admin_login ─ POST { email, password } ─────────────────────
async function admin_login(req, res) {
  const email = field(req, 'email')
  const password = field(req, 'password')
  if (!email) return sendFail(res, 'Parameter not matched', STATUS.BAD_REQUEST)

  const admin = await prisma.admin.findUnique({ where: { email: email.trim().toLowerCase() } })
  if (admin && password && (await bcrypt.compare(password, admin.passwordHash))) {
    return sendOk(res, 'Login Success')
  }
  return sendFail(res, 'Credentials not matched', STATUS.UNAUTHORIZED)
}

// ── check_status ─ POST { mobile } → user row ──────────────────
async function check_status(req, res) {
  const mobile = field(req, 'mobile')
  if (!mobile) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  const user = await prisma.user.findFirst({ where: { phone: mobile }, include: { access: true } })
  if (!user) return sendFail(res, 'Inactive User', STATUS.NOT_FOUND)
  return sendOk(res, 'Active User Save Successfully', { data: toPhpUser(user, (await productMaps()).codeById) })
}

// ── fetch_user / audio_donation_user ─ all users ───────────────
async function fetch_user(req, res) {
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' }, include: { access: true } })
  if (!users.length) return sendFail(res, 'Credentials not matched', STATUS.NOT_FOUND)
  const { codeById } = await productMaps()
  return sendOk(res, 'User loaded', { data: users.map((u) => toPhpUser(u, codeById)) })
}

// ── update_session ─ POST { mobile, active } ───────────────────
async function update_session(req, res) {
  const mobile = field(req, 'mobile')
  const active = field(req, 'active')
  if (mobile === undefined || active === undefined) {
    return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)
  }

  try {
    // Session state lives in login_user, not on the user row. This used to
    // write users.status, which collided with the admin's enable/disable
    // switch — the app could silently re-enable an account the panel had just
    // disabled, or disable one nobody had touched.
    //
    // active='0' ends the session by removing the device rows. active='1' is
    // accepted and does nothing: a session is created by verifyOTP, which is
    // the only place a device id exists to bind.
    if (active !== '1') {
      await prisma.$executeRawUnsafe(`DELETE FROM login_user WHERE mobile = ?`, mobile)
    }
    return sendOk(res, 'Updated Successfully', { active })
  } catch {
    return sendFail(res, 'Something went wrong', STATUS.SERVER_ERROR)
  }
}

// ── check_active_session ─ POST { mobile, DID } ────────────────
async function check_active_session(req, res) {
  const mobile = field(req, 'mobile')
  const did = field(req, 'DID')
  if (!mobile || !did) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM login_user WHERE mobile = ? AND device_id = ?`,
    mobile, did
  )
  if (jsonSafe(rows).length > 0) {
    return sendOk(res, 'Login Success')
  }
  return sendFail(res, 'Is Logged Out', STATUS.UNAUTHORIZED)
}

// ── home ─ [auth] → all active modules with owned flag + song counts ──
// Drives the app's home screen. DB-driven: newly created Parts appear
// automatically without any code change.
async function home(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.mobileUser.id } })
  if (!user) return sendFail(res, 'User not found', STATUS.NOT_FOUND)

  // All active products from DB — no hardcoded list
  const products = await prisma.product.findMany({ where: { active: true }, orderBy: { id: 'asc' } })

  // Published-song count per module (for the badge under each module)
  const counts = await prisma.content.groupBy({
    by: ['productId'],
    where: { published: true },
    _count: { _all: true },
  })
  const countMap = new Map(counts.map((c) => [c.productId, c._count._all]))

  // Owned product IDs (legacy flag columns + UserAccess table)
  const ownedIds = await getOwnedProductIds(user.id)

  // `code` on the wire is the PUBLIC code the APK already knows ("gita1"),
  // even though rows are now joined on the numeric id.
  const modules = products.map((p) => ({
    code: p.code,
    name: p.name,
    price: p.price,
    owned: ownedIds.has(p.id),
    songCount: countMap.get(p.id) || 0,
  }))

  return sendOk(res, 'Modules', { modules })
}

// ── get_content ─ [auth] { product } → songs of a module ───────
// Returns the published songs/lyrics of a module. The user is taken from
// the Bearer token (not a param) so ownership can't be spoofed.
// Lyrics are always returned (free for all users).
// audioUrl is withheld until the module is owned — the app shows a locked state.
// One content row as the app receives it. Shared by get_content and the
// per-session calls below so a song never looks different depending on which
// screen asked for it.
function shapeItem(req, c, owned, sections) {
  return {
    id: c.id,
    title: c.title,
    type: c.type,
    duration: c.duration,
    sortOrder: c.sortOrder,
    plays: c.plays,
    locked: !owned,
    audioUrl: owned ? absUrl(req, c.audioUrl) : null,
    lyrics: c.lyrics || '',
    // Where the item sits in the Part's menu. `sectionId` is null and
    // `sectionPath` is empty for an item that sits directly in the Part —
    // which is every item the deployed APK already knows about, so its list
    // is unchanged and these fields are simply ignored by it.
    sectionId: c.nodeId ?? null,
    sectionPath: c.nodeId ? sectionPath(c.nodeId, sections) : [],
    // When the item is meant to be played. Empty arrays = unscheduled; the
    // app decides what to do with it. Nothing is filtered out server-side,
    // so the deployed APK keeps getting exactly the list it gets today.
    schedule: groupSchedule(c.schedule),
  }
}

async function get_content(req, res) {
  const code = field(req, 'product')
  if (!code) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  // Validate against DB — accepts any product, not just the 4 hardcoded ones
  const product = await prisma.product.findUnique({ where: { code } })
  if (!product) return sendFail(res, 'Invalid module', STATUS.BAD_REQUEST)

  const user = await prisma.user.findUnique({ where: { id: req.mobileUser.id } })
  if (!user) return sendFail(res, 'User not found', STATUS.NOT_FOUND)

  const ownedIds = await getOwnedProductIds(user.id)
  const owned = ownedIds.has(product.id)

  const rows = await prisma.content.findMany({
    where: { productId: product.id, published: true, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    include: { schedule: true },
  })

  // Section names for this Part, so each item can say where it belongs.
  const sections = await sectionMap([product.id])

  // ?section=<id> narrows the list to one part of the menu — the section the
  // user tapped, plus everything inside it. ?section=none returns the items
  // that sit directly in the module. Leaving it out returns everything, which
  // is what the deployed APK does today.
  const sectionRef = field(req, 'section')
  let visible = rows
  if (sectionRef !== undefined && sectionRef !== null && String(sectionRef).trim() !== '') {
    if (String(sectionRef) === 'none') {
      visible = rows.filter((c) => c.nodeId === null)
    } else {
      const rootId = Number(sectionRef)
      if (Number.isNaN(rootId)) return sendFail(res, 'section must be a number or "none"', STATUS.BAD_REQUEST)
      if (!sections.has(rootId)) return sendFail(res, 'Section not found in this module', STATUS.NOT_FOUND)
      const wanted = subtreeIds(rootId, sections)
      visible = rows.filter((c) => c.nodeId !== null && wanted.has(c.nodeId))
    }
  }

  const content = visible.map((c) => shapeItem(req, c, owned, sections))

  return sendOk(res, 'Content loaded', {
    owned,
    product: { code, name: product.name, price: product.price },
    content,
  })
}

// ── get_sections ─ [auth] → the whole menu, nested, with files ─
//   ?apicall=get_sections&code=gita1
//
// ONE call gives the app everything it needs to draw every screen of a module:
// the sections nested inside each other, and the songs sitting in each one.
//
//   सकाळ (Morning)
//     └── varachi pade
//           ├── सोमवार (Monday)   → file
//           └── मंगळवार (Tuesday)  → file
//   संध्याकाळ (Evening)
//
// Nested rather than flat because the app draws it as a menu, and nesting is
// the shape a menu already has. Depth is not fixed — a module may be two
// levels deep or five — so the app should walk `children` rather than assume
// a number of levels.
//
// Songs that sit directly in the module, in no section at all, are returned
// separately under `unsectioned`. That is where every song added before the
// menu existed lives, so leaving them out would hide most of the content.
async function get_sections(req, res) {
  const code = field(req, 'code') || field(req, 'product')
  if (!code) return sendFail(res, 'code is required', STATUS.BAD_REQUEST)

  const product = await prisma.product.findUnique({ where: { code } })
  if (!product) return sendFail(res, 'Module not found', STATUS.NOT_FOUND)

  const user = await prisma.user.findUnique({ where: { id: req.mobileUser.id } })
  if (!user) return sendFail(res, 'User not found', STATUS.NOT_FOUND)

  // Same purchase rule as get_content: the URL is withheld until the module is
  // owned, while titles and lyrics stay visible so the app can show a locked
  // list rather than an empty one.
  const ownedIds = await getOwnedProductIds(user.id)
  const owned = ownedIds.has(product.id)

  const [nodes, rows] = await Promise.all([
    prisma.contentNode.findMany({
      where: { productId: product.id },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.content.findMany({
      where: { productId: product.id, published: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { schedule: true },
    }),
  ])

  // One song as it appears inside the menu.
  const asFile = (c) => ({
    id: c.id,
    title: c.title,
    // Null until the module is bought — the same rule the old API follows.
    url: owned ? absUrl(req, c.audioUrl) : null,
    otherData: {
      type: c.type,
      duration: c.duration,
      sortOrder: c.sortOrder,
      plays: c.plays,
      locked: !owned,
      lyrics: c.lyrics || '',
      schedule: groupSchedule(c.schedule),
    },
  })

  // Songs grouped by the section they sit in, so the tree is built without
  // scanning the whole list once per section.
  const filesOf = new Map()
  for (const c of rows) {
    const key = c.nodeId ?? 'none'
    if (!filesOf.has(key)) filesOf.set(key, [])
    filesOf.get(key).push(asFile(c))
  }

  const childrenOf = new Map()
  for (const n of nodes) {
    const key = n.parentId ?? 'root'
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key).push(n)
  }

  // What sits inside a node is named after WHAT those things are rather than
  // the generic "children": a session holds `subParts`, a sub part holds
  // `days`. The name comes from the children's own `kind`, so it describes the
  // data instead of assuming a fixed depth.
  const CHILD_KEYS = { session: 'sessions', 'sub part': 'subParts', day: 'days' }

  // Nothing inside, several kinds mixed together, or a `kind` the admin typed
  // by hand: there is no one truthful name for the list, so the generic one is
  // used. The app must therefore read `sections` as well as the specific keys.
  const FALLBACK_CHILD_KEY = 'sections'
  const childKey = (nodes) => {
    if (!nodes.length) return FALLBACK_CHILD_KEY
    const kinds = new Set(nodes.map((n) => n.kind || ''))
    if (kinds.size !== 1) return FALLBACK_CHILD_KEY
    return CHILD_KEYS[[...kinds][0]] || FALLBACK_CHILD_KEY
  }

  const build = (parentKey) =>
    (childrenOf.get(parentKey) || []).map((n) => {
      const files = filesOf.get(n.id) || []
      const inside = childrenOf.get(n.id) || []
      return {
        id: n.id,
        name: n.name,
        // A free-text label the admin chose ("session", "sub part", "day").
        // Shown as-is; the app should not branch on it.
        kind: n.kind || null,
        [childKey(inside)]: build(n.id),
        // `file` is the convenient one — a day holds exactly one song, so this
        // is what a day screen needs. `files` carries them all for a section
        // that holds several, and is null-free.
        file: files[0] || null,
        files,
      }
    })

  // The top level is named the same way, so the response reads
  // `sessions` → `subParts` → `days` all the way down.
  const roots = childrenOf.get('root') || []

  return sendOk(res, 'Sections loaded', {
    owned,
    product: { code, name: product.name, price: product.price },
    [childKey(roots)]: build('root'),
    unsectioned: filesOf.get('none') || [],
  })
}

// ── subscribed_items ─ [auth] → only modules the user has subscribed to ─
// Same shape as `home` but filters out modules the user does NOT own.
// Powers the "My Subscriptions" screen. DB-driven: new Parts appear here
// immediately after purchase with no code changes required.
async function subscribed_items(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.mobileUser.id } })
  if (!user) return sendFail(res, 'User not found', STATUS.NOT_FOUND)

  // Owned product IDs from both legacy flags and UserAccess (covers all products)
  const ownedIds = await getOwnedProductIds(user.id)
  if (!ownedIds.size) {
    return sendOk(res, 'No subscriptions', { items: [] })
  }

  const productIds = [...ownedIds]
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } })
  const byId = new Map(products.map((p) => [p.id, p]))

  const counts = await prisma.content.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds }, published: true, deletedAt: null },
    _count: { _all: true },
  })
  const countMap = new Map(counts.map((c) => [c.productId, c._count._all]))

  const items = productIds.map((id) => {
    const p = byId.get(id)
    return {
      code: p?.code || String(id),
      name: p?.name || String(id),
      price: p?.price ?? 0,
      itemCount: countMap.get(id) || 0,
    }
  })

  return sendOk(res, 'Subscribed items', { items })
}

// ── sub_items ─ [auth] { product } → detailed list of sub-items ─
// Returns the published sub-items (Content rows) of a subscribed module.
// Unlike `get_content`, this refuses outright if the user has NOT paid
// for the module — the "My Subscriptions → detail" screen never shows
// locked rows because it only lists modules the user already owns.
// Media/lyrics are withheld here; the app calls `get_media` on tap.
async function sub_items(req, res) {
  const code = field(req, 'product')
  if (!code) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  // Validate against DB — accepts any product, not just the 4 hardcoded ones
  const product = await prisma.product.findUnique({ where: { code } })
  if (!product) return sendFail(res, 'Invalid module', STATUS.BAD_REQUEST)

  const user = await prisma.user.findUnique({ where: { id: req.mobileUser.id } })
  if (!user) return sendFail(res, 'User not found', STATUS.NOT_FOUND)

  const ownedIds = await getOwnedProductIds(user.id)
  if (!ownedIds.has(product.id)) {
    return sendFail(res, 'This module is not subscribed', STATUS.FORBIDDEN)
  }

  const rows = await prisma.content.findMany({
    where: { productId: product.id, published: true, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    include: { schedule: true },
  })

  const items = rows.map((c) => ({
    id: c.id,
    title: c.title,
    type: c.type,
    duration: c.duration,
    sortOrder: c.sortOrder,
    plays: c.plays,
    hasAudio: !!c.audioUrl,
    hasLyrics: !!c.lyrics,
    schedule: groupSchedule(c.schedule),
  }))

  return sendOk(res, 'Sub items loaded', {
    product: { code, name: product.name, price: product.price },
    items,
  })
}

// ── get_media ─ [auth] { id } → media file for a tapped item ───
// Called when the user taps an item. Lyrics are returned for all logged-in
// users (no subscription required). audioUrl is only returned when the user
// owns the module; otherwise audioUrl is null and locked is true so the app
// can show the locked audio state without blocking the lyrics view.
async function get_media(req, res) {
  const id = field(req, 'id')
  if (!id) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  const item = await prisma.content.findUnique({ where: { id: Number(id) } })
  // deletedAt: a binned item is gone as far as the app is concerned.
  if (!item || !item.published || item.deletedAt) {
    return sendFail(res, 'Content not found', STATUS.NOT_FOUND)
  }

  const user = await prisma.user.findUnique({ where: { id: req.mobileUser.id } })
  if (!user) return sendFail(res, 'User not found', STATUS.NOT_FOUND)

  // Check ownership by productId — works for all products via UserAccess + legacy flags
  const ownedIds = await getOwnedProductIds(user.id)
  const owned = ownedIds.has(item.productId)

  return sendOk(res, 'Media loaded', {
    id: item.id,
    title: item.title,
    type: item.type,
    duration: item.duration,
    audioUrl: owned ? absUrl(req, item.audioUrl) : null,
    lyrics: item.lyrics || '',
    locked: !owned,
  })
}

// ── mark_played ─ [auth] { id } → +1 play count ────────────────
// Called by the app when a song actually starts playing. Only counts if
// the caller owns the module the song belongs to.
async function mark_played(req, res) {
  const id = field(req, 'id')
  if (!id) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  try {
    const item = await prisma.content.findUnique({ where: { id: Number(id) } })
    if (!item || item.deletedAt) return sendFail(res, 'Content not found', STATUS.NOT_FOUND)

    const user = await prisma.user.findUnique({ where: { id: req.mobileUser.id } })
    if (!user) return sendFail(res, 'User not found', STATUS.NOT_FOUND)

    const ownedIds = await getOwnedProductIds(user.id)
    if (!ownedIds.has(item.productId)) {
      return sendFail(res, 'This module is not unlocked for you', STATUS.FORBIDDEN)
    }

    await prisma.content.update({ where: { id: item.id }, data: { plays: { increment: 1 } } })
    return sendOk(res, 'OK')
  } catch {
    return sendFail(res, 'Could not record play', STATUS.SERVER_ERROR)
  }
}

// ── Photo gallery (छायाचित्रे) ─────────────────────────────────
// Same albums/photos the admin panel manages at /admin/gallery and the
// website shows at /events — so whatever an admin publishes appears in
// the app with no rebuild. Only `published` albums are ever exposed.
//
// Image paths are stored relative ("/uploads/image/…"), so every url is
// run through absUrl() and handed to the app as a full https URL it can
// drop straight into an Image widget.
const shapeGalleryAlbum = (req, a) => ({
  id: a.id,
  title: a.title,
  category: a.category,
  date: ymd(a.date),
  cover: absUrl(req, a.cover),
  photoCount: (a.photos || []).length,
  photos: (a.photos || [])
    .slice()
    .sort((x, y) => x.sortOrder - y.sortOrder || x.id - y.id)
    .map((p) => ({
      key: `p${p.id}`,
      id: p.id,
      url: absUrl(req, p.url),
      caption: p.caption || '',
      sortOrder: p.sortOrder,
      isCover: false,
    })),
})

// ── gallery ─ [public] { category?, page?, limit? } ────────────
// Returns both shapes the screen needs in ONE call:
//   albums[] — for the album/category listing
//   photos[] — one flat list for the carousel + grid
async function gallery(req, res) {
  const category = field(req, 'category') || 'all'
  const where = { published: true }
  if (category !== 'all') where.category = category

  const rows = await prisma.album.findMany({
    where,
    include: { photos: true },
    orderBy: { id: 'desc' }, // newest album first — matches panel and website
  })
  const albums = rows.map((a) => shapeGalleryAlbum(req, a))

  // Flat photo list for the grid. An album with no photos added yet falls
  // back to its cover, otherwise a freshly created album would be invisible.
  const photos = albums.flatMap((a) => {
    const from = { albumId: a.id, albumTitle: a.title, category: a.category }
    if (a.photos.length) return a.photos.map((p) => ({ ...p, ...from }))
    if (!a.cover) return []
    return [{ key: `c${a.id}`, id: null, url: a.cover, caption: '', sortOrder: 0, isCover: true, ...from }]
  })

  // page/limit are optional — sent nothing, the app gets the whole list.
  const pg = paginate(
    photos,
    { page: field(req, 'page'), limit: field(req, 'limit') },
    { defaultLimit: 30, maxLimit: 200 }
  )

  // Tabs for the app: always every published category, never just the
  // filtered one, so the tab bar does not shrink after a filter is applied.
  const catRows = await prisma.album.groupBy({
    by: ['category'],
    where: { published: true },
    _count: { _all: true },
  })
  const categories = catRows
    .map((c) => ({ key: c.category, albumCount: c._count._all }))
    .sort((a, b) => a.key.localeCompare(b.key))

  return sendOk(res, 'Gallery loaded', {
    categories,
    albums,
    photos: pg.data,
    total: pg.total,
    page: pg.page,
    pages: pg.pages,
    limit: pg.limit,
  })
}

// ── gallery_album ─ [public] { id } → one published album ──────
async function gallery_album(req, res) {
  const id = Number(field(req, 'id'))
  if (!id) return sendFail(res, 'Check parameter', STATUS.BAD_REQUEST)

  const album = await prisma.album.findFirst({
    where: { id, published: true },
    include: { photos: true },
  })
  if (!album) return sendFail(res, 'Album not found', STATUS.NOT_FOUND)

  return sendOk(res, 'Album loaded', { album: shapeGalleryAlbum(req, album) })
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
  // New: content delivery for the app (all require a Bearer token).
  home,
  get_content,
  get_sections,
  mark_played,
  // Subscription-scoped variants (used by the "My Subscriptions" flow).
  subscribed_items,
  sub_items,
  get_media,
  // Photo gallery — public, read-only.
  gallery,
  gallery_album,
}

// apicalls that do NOT need a Bearer token — they run before a token
// exists (login flow), use their own credentials, or serve content that
// is already public on the website (the gallery).
const PUBLIC_APICALLS = new Set([
  'loginuser',
  'verifyOTP',
  'register',
  'admin_login',
  'gallery',
  'gallery_album',
])

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

  const rows = jsonSafe(await prisma.$queryRawUnsafe(`SELECT token, status FROM users WHERE id = ?`, payload.id))
  if (!rows.length || rows[0].token !== token) {
    return { ok: false, message: 'Logged in on another device. Please log in again.' }
  }
  // Checked on every call, not just at login: a token issued before the admin
  // disabled the account is valid for a year, so without this the person would
  // keep full access until it expired.
  if (rows[0].status === 'disabled') {
    return { ok: false, message: 'This account has been disabled. Please contact the temple.' }
  }
  return { ok: true, payload }
}

// Single dispatcher entry point — reads ?apicall= like API.php did.
export async function dispatch(req, res) {
  const apicall = req.query.apicall || req.body?.apicall
  if (!apicall) {
    return sendFail(res, 'Invalid API Call', STATUS.BAD_REQUEST)
  }
  const handler = handlers[apicall]
  if (!handler) {
    return sendFail(res, 'Invalid Operation Called', STATUS.NOT_FOUND)
  }

  // Protected apicalls require a valid Bearer token.
  if (!PUBLIC_APICALLS.has(apicall)) {
    const auth = await authenticateMobile(req)
    if (!auth.ok) return sendFail(res, auth.message, STATUS.UNAUTHORIZED)
    req.mobileUser = auth.payload // { id, mobile, name } — available to handlers
  }

  return handler(req, res)
}
