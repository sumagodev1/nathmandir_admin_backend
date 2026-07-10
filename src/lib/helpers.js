// Small shared helpers used across routes.

// Format a Date (or date string) as "YYYY-MM-DD" — matches the admin panel.
export const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)

// Make raw-query rows JSON-safe: MySQL BigInt columns can't be JSON.stringify'd.
export const jsonSafe = (val) =>
  JSON.parse(JSON.stringify(val, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)))

// kebab-case product code from a name, kept unique against existing codes.
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
  const access = u.access.map((a) => a.productId)
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
