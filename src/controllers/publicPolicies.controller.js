// ── Public policies controller ────────────────────────────────
// Read-only, no auth. Two faces of the same rows:
//
//   JSON — for the website's /privacy-policy and /terms-and-conditions pages.
//   HTML — server-rendered with EJS (src/views/policies/). These are the URLs
//          to give the Play Store / App Store, to open in a browser, or to load
//          in the app's WebView. Add ?app=1 to drop the page header and footer
//          when the app shows it under its own title bar.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ejs from 'ejs'
import {
  POLICY_LABELS,
  isPolicyType,
  shapePolicy,
  findPolicy,
  listPolicies,
  isMissingTable,
  MISSING_TABLE_HINT,
} from '../lib/policies.js'

const VIEWS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'views', 'policies')

// Shown on the HTML pages. Kept in step with the website's src/constants/site.js.
const SITE = {
  name: 'Nath Mandir Nashik',
  fullName: 'Shri Madhavnath Mandir, Nashik',
  email: 'nathmandirnashik@gmail.com',
}

// Same date style as Avigo: "2 October 2026".
const longDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' })

// A missing table is "not published yet" to a reader, not a server error.
const safeFind = async (type) => {
  try {
    return await findPolicy(type)
  } catch (e) {
    if (isMissingTable(e)) { console.warn(MISSING_TABLE_HINT); return null }
    throw e
  }
}
const safeList = async () => {
  try {
    return await listPolicies()
  } catch (e) {
    if (isMissingTable(e)) { console.warn(MISSING_TABLE_HINT); return [] }
    throw e
  }
}

// ── JSON ───────────────────────────────────────────────────────

// GET /api/public/policies   — every published policy
export async function list(req, res) {
  const rows = await safeList()
  res.json({ policies: rows.map(shapePolicy) })
}

// GET /api/public/policies/:type   — one policy
export async function get(req, res) {
  const { type } = req.params
  if (!isPolicyType(type)) return res.status(400).json({ error: 'Unknown policy type. Use "privacy" or "terms".' })
  const row = await safeFind(type)
  if (!row) return res.status(404).json({ error: `${POLICY_LABELS[type]} not found.` })
  res.json({ policy: shapePolicy(row) })
}

// ── HTML (EJS) ─────────────────────────────────────────────────

const webHref = (req, type, app) => `${req.baseUrl}/web/${type}${app ? '?app=1' : ''}`

async function render(res, status, view, data) {
  const html = await ejs.renderFile(path.join(VIEWS, `${view}.ejs`), {
    site: SITE,
    year: new Date().getFullYear(),
    ...data,
  })
  res.status(status).type('html').send(html)
}

// GET /api/public/policies/web/:type   — one policy as a web page
export async function webPage(req, res) {
  const { type } = req.params
  const app = req.query.app === '1' || req.query.app === 'true'
  if (!isPolicyType(type)) {
    return render(res, 404, 'not-found', { label: 'Policy', app })
  }

  const row = await safeFind(type)
  if (!row) return render(res, 404, 'not-found', { label: POLICY_LABELS[type], app })

  render(res, 200, 'policy', {
    app,
    policy: { ...shapePolicy(row), updatedOn: longDate(row.updatedAt) },
  })
}

// GET /api/public/policies/web/all   — every policy on one page
export async function webAll(req, res) {
  const app = req.query.app === '1' || req.query.app === 'true'
  const rows = await safeList()
  render(res, 200, 'all', {
    app,
    policies: rows.map((r) => ({ ...shapePolicy(r), updatedOn: longDate(r.updatedAt), href: webHref(req, r.type, app) })),
  })
}
