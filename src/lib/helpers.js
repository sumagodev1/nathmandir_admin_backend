// Small shared helpers used across routes.

// ── Pagination ────────────────────────────────────────────────
// Slice an already-built (and already-filtered) array using the
// request's ?page & ?limit query params.
//
// Backward compatible: if NEITHER `page` nor `limit` is present the whole
// array is returned (so existing clients that read the full list keep working).
// `total` is always the full, unpaged count.
//
//   const pg = paginate(rows, req.query)
//   res.json({ users: pg.data, total: pg.total, page: pg.page, pages: pg.pages, limit: pg.limit })
export const paginate = (rows, query = {}, { defaultLimit = 20, maxLimit = 200 } = {}) => {
  const total = rows.length
  const hasPaging = query.page !== undefined || query.limit !== undefined
  if (!hasPaging) {
    return { data: rows, total, page: 1, pages: 1, limit: total }
  }
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit))
  const pages = Math.max(1, Math.ceil(total / limit))
  const page = Math.min(pages, Math.max(1, parseInt(query.page, 10) || 1))
  const start = (page - 1) * limit
  return { data: rows.slice(start, start + limit), total, page, pages, limit }
}

// Format a Date (or date string) as "YYYY-MM-DD" — matches the admin panel.
export const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)

// Make raw-query rows JSON-safe: MySQL BigInt columns can't be JSON.stringify'd.
export const jsonSafe = (val) =>
  JSON.parse(JSON.stringify(val, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)))

// kebab-case product code from a name, kept unique against existing codes.
// NOTE: products now use lib/products.js -> uniqueCode(). Kept for any other caller.
export const slugify = (s, taken = []) => {
  const base =
    String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'part'
  let id = base
  let n = 2
  while (taken.includes(id)) id = `${base}-${n++}`
  return id
}

// Access status for a user's access row on a product.
export const accessLabel = (row) =>
  row ? (row.source === 'purchased' ? 'subscribed' : 'granted') : 'none'

// Expiry date for a manual access grant. null = permanent (till revoked).
export const grantExpiry = (durationKey, fromDate = new Date()) => {
  const days = durationKey === 'd7' ? 7 : durationKey === 'd15' ? 15 : null
  if (days == null) return null
  const dt = new Date(fromDate)
  dt.setDate(dt.getDate() + days)
  return dt
}

// Shape a user (with `access` + `sales` included) into the row the UI expects.
export const shapeUserRow = (u) => {
  // Ownership comes solely from user_access rows. Expired rows are excluded so
  // the "subscribed" badge and access list reflect what the user can actually use.
  const now = new Date()
  const access = u.access
    .filter((a) => !a.expiresOn || a.expiresOn > now)
    .map((a) => a.productId)
  const totalPaid = u.sales.reduce((sum, s) => sum + s.amount, 0)
  const saleDates = u.sales.map((s) => ymd(s.createdAt)).sort()
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    email: u.email || '',
    address: u.address || '',
    city: u.city,
    status: u.status,
    registeredOn: ymd(u.registeredOn),
    lastLogin: ymd(u.lastLogin),
    access,
    subscribed: access.length > 0,
    totalPaid,
    subscribedSince: saleDates[0] || null,
    // real production fields
    isPaid: u.isPaid ?? 0,
    donation: u.donation ?? 0,
    amount: u.amount || '',
  }
}
