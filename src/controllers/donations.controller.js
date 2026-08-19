// ── Donations controller ──────────────────────────────────────
// Merges two sources:
//   • user_donation — legacy in-app donations (linked to a user row)
//   • donation      — new website Razorpay donations (donor details inline)
// Handler for /api/donations.
import { prisma } from '../lib/prisma.js'
import { ymd, jsonSafe, paginate } from '../lib/helpers.js'

const CATEGORY_LABEL = {
  'temple-development': 'Temple Development',
  annadan: 'Annadan (Mahaprasad)',
  'festival-support': 'Festival Support',
  general: 'General Donation',
}

// How the money reached the temple.
const MODE_LABEL = { online: 'Website', cash: 'Cash', bank: 'Bank Transfer' }
const OFFLINE_MODES = ['cash', 'bank']

// "YYYY-MM-DD HH:MM:SS" in server-local time — the same wall clock MySQL writes
// for CURRENT_TIMESTAMP, so hand-entered rows sort correctly against the ones
// the website created. `dateOnly` is the optional "YYYY-MM-DD" from the form;
// the time of day always comes from now.
function localStamp(dateOnly) {
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateOnly || '').trim())
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3], now.getHours(), now.getMinutes(), now.getSeconds()) : now
  if (Number.isNaN(d.getTime())) return localStamp('')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Both sources are legacy raw tables created by prisma/legacy-tables.sql
// rather than by a Prisma migration. If one of them was never applied, an
// unguarded query takes the whole endpoint down with a bare 500 — the admin
// screen then just says "Something went wrong on the server", which says
// nothing about which table is missing. Serve whichever source is available
// and name the missing one in the server log instead.
async function readSource(label, sql) {
  try {
    return await prisma.$queryRawUnsafe(sql)
  } catch (err) {
    const detail = err.message.split('\n').map((l) => l.trim()).filter(Boolean).pop()
    console.error(
      `⚠️  /api/donations: skipping the "${label}" source — ${detail}\n` +
        '   If the table is missing, run: node prisma/apply-legacy-tables.js'
    )
    return []
  }
}

// GET /api/donations?page=&limit=
export async function list(req, res) {
  // In-app donations, read from the payment record itself.
  //
  // This used to read `user_donation`, which the app was supposed to write
  // alongside the payment — but for at least one transaction it never did, and
  // that donation was invisible here while showing normally under Payments
  // (₹1,001 from user 264 on 2022-02-17, razorpay pay_IwvVE50P6z9TJW). Sourcing
  // from the row Razorpay actually settles removes the second write that could
  // be missed. `user_donation` holds no donation that is not in here.
  //
  // package_id 3 is "Donation" in the `package` table (1/2 = Gitanjali Parts,
  // 4 = Upasana, 5 = Nityaniyam). Matched on package_id rather than the
  // payment_type text column, which is blank on some completed rows.
  //
  // status = 1 is settled. Without it the 46 abandoned checkouts still sitting
  // at status 0 would be counted, adding a fictional ₹1.18 lakh to the total.
  const appRows = await readSource(
    'user_payment (in-app donations)',
    `SELECT p.id, p.user_id AS userId, u.name AS userName, u.phone AS mobile,
            p.amount, p.razorpay_payment_id AS paymentId, p.created_at AS createdAt
     FROM user_payment p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.package_id = 3 AND p.status = 1
     ORDER BY p.created_at DESC`
  )
  // New website Razorpay donations (successful only).
  // Website Razorpay donations plus anything an admin recorded by hand.
  const webRows = await readSource(
    'donation (website)',
    `SELECT id, name, mobile, amount, category, razorpay_payment_id AS paymentId,
            mode, txn_ref AS txnRef, note, created_at AS createdAt
     FROM donation WHERE status = '1' ORDER BY created_at DESC`
  )

  const donations = [
    ...jsonSafe(appRows).map((r) => ({
      id: 'A' + r.id,
      gateway: 'App',
      userId: r.userId,
      user: r.userName || '',
      mobile: r.mobile || '',
      category: '',
      amount: Number(r.amount) || 0,
      // Now that the source is the payment row, the Razorpay id is available —
      // the Transaction ID column used to be a dash on every app donation.
      txn: r.paymentId || '',
      date: ymd(r.createdAt),
      _at: new Date(r.createdAt).getTime() || 0,
    })),
    ...jsonSafe(webRows).map((r) => ({
      id: 'W' + r.id,
      // An offline row has no gateway — say how the money actually arrived so
      // the admin can tell a Razorpay payment from cash handed in at the temple.
      gateway: MODE_LABEL[r.mode] || 'Website',
      mode: r.mode || 'online',
      userId: null,
      user: r.name || '',
      mobile: r.mobile || '',
      category: CATEGORY_LABEL[r.category] || r.category || '',
      amount: Number(r.amount) || 0,
      // Razorpay id for online, bank reference/UTR for a transfer, blank for cash.
      txn: r.paymentId || r.txnRef || '',
      note: r.note || '',
      date: ymd(r.createdAt),
      _at: new Date(r.createdAt).getTime() || 0,
    })),
  ]
    // Sort on the full timestamp, not the "YYYY-MM-DD" string. `date` has only
    // day precision, so every donation received on the same day compared equal
    // and kept its merge order — a donation recorded just now sat underneath
    // the ones already there instead of at the top.
    // Same instant (bulk imports share one timestamp) falls back to the id, so
    // the row saved last still wins.
    .sort((a, b) => b._at - a._at || Number(b.id.slice(1)) - Number(a.id.slice(1)))
    .map(({ _at, ...row }) => row)

  const pg = paginate(donations, req.query)
  res.json({
    donations: pg.data,
    total: pg.total,
    page: pg.page,
    pages: pg.pages,
    limit: pg.limit,
    totalAmount: donations.reduce((s, d) => s + d.amount, 0),
  })
}

// POST /api/donations
// Records a donation that never went through Razorpay — cash given at the
// temple, or a direct transfer to the bank account shown in the app. Written
// into the same `donation` table with status '1' so it lands in the list, the
// totals and the exports alongside online ones.
export async function create(req, res) {
  const {
    name = '', mobile = '', email = '', amount,
    category = 'general', mode, txnRef = '', note = '', date = '',
  } = req.body || {}

  if (!String(name).trim()) return res.status(400).json({ error: 'Donor name is required.' })

  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Enter a donation amount greater than zero.' })
  }

  if (!OFFLINE_MODES.includes(mode)) {
    return res.status(400).json({ error: 'Choose how the donation was received — Cash or Bank Transfer.' })
  }

  // A bank transfer without its reference cannot be matched against the
  // statement later, which is the whole reason for recording it. Cash has no
  // such reference, so the field stays optional there.
  const ref = String(txnRef).trim()
  if (mode === 'bank' && !ref) {
    return res.status(400).json({ error: 'Transaction ID is required for a bank transfer.' })
  }

  // The admin can back-date an entry — cash is often written up days later.
  //
  // The form sends a date with no time ("2026-08-10"), and storing that alone
  // means midnight, which put every hand-entered donation *below* the ones
  // already recorded that day. Keep the chosen date but carry the current
  // clock time, so entries made today land at the top and several entries
  // back-dated to the same day still order by when they were typed.
  //
  // The value is built as a plain wall-clock string rather than a Date: MySQL
  // writes CURRENT_TIMESTAMP in server-local time and the driver hands those
  // rows back labelled UTC, so passing a Date here would shift a manual entry
  // by the timezone offset and mis-sort it against the website's own rows.
  const when = localStamp(date)

  await prisma.$executeRawUnsafe(
    `INSERT INTO donation
       (name, mobile, email, amount, category, status, mode, txn_ref, note, recorded_by, created_at)
     VALUES (?, ?, ?, ?, ?, '1', ?, ?, ?, ?, ?)`,
    String(name).trim(),
    String(mobile).trim() || null,
    String(email).trim() || null,
    String(amt),
    String(category).trim() || 'general',
    mode,
    mode === 'bank' ? ref : (ref || null),
    String(note).trim() || null,
    req.admin?.name || req.admin?.email || null,
    when
  )

  const [row] = await prisma.$queryRawUnsafe(
    `SELECT id, name, mobile, amount, category, mode, txn_ref AS txnRef, note, created_at AS createdAt
     FROM donation ORDER BY id DESC LIMIT 1`
  )
  const r = jsonSafe(row)

  res.status(201).json({
    donation: {
      id: 'W' + r.id,
      gateway: MODE_LABEL[r.mode] || 'Website',
      mode: r.mode,
      userId: null,
      user: r.name || '',
      mobile: r.mobile || '',
      category: CATEGORY_LABEL[r.category] || r.category || '',
      amount: Number(r.amount) || 0,
      txn: r.txnRef || '',
      note: r.note || '',
      date: ymd(r.createdAt),
    },
  })
}
