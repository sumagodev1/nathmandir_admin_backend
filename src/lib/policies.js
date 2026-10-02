// ── Legal policies: shared rules ──────────────────────────────
// Used by the admin API, the public website API, the EJS web pages and the
// mobile app's apicalls, so all four agree on what a type is, what HTML is
// allowed, and what a policy looks like on the wire.
import sanitizeHtml from 'sanitize-html'
import { prisma } from './prisma.js'

export const POLICY_TYPES = ['privacy', 'terms']

export const POLICY_LABELS = {
  privacy: 'Privacy Policy',
  terms: 'Terms & Conditions',
}

export const isPolicyType = (t) => POLICY_TYPES.includes(String(t || ''))

// What the admin's rich-text editor (Jodit) produces for a text document:
// headings, lists, tables, links, basic emphasis. Scripts, iframes, forms and
// event handlers are dropped, because this HTML is shown unescaped on the
// website, on the EJS pages and inside the app's WebView.
const SANITIZE = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'div', 'span',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'blockquote', 'pre', 'code',
    'ul', 'ol', 'li', 'a',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    '*': ['style'],
  },
  // Inline styles are limited to the text formatting the editor offers, so a
  // pasted document cannot position things over the page.
  allowedStyles: {
    '*': {
      'text-align': [/^(left|right|center|justify)$/],
      'font-weight': [/^(bold|normal|[1-9]00)$/],
      'font-style': [/^(italic|normal)$/],
      'text-decoration': [/^[a-z\s-]+$/],
      color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // External links open in a new tab and cannot reach back into this page.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: /^https?:/i.test(attribs.href || '')
        ? { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
        : attribs,
    }),
  },
}

export const cleanPolicyHtml = (html) => sanitizeHtml(String(html || ''), SANITIZE).trim()

// True when the HTML holds no readable text, e.g. Jodit's empty "<p><br></p>".
export const isBlankHtml = (html) =>
  sanitizeHtml(String(html || ''), { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;/g, ' ').trim() === ''

export const shapePolicy = (p) => ({
  id: p.id,
  type: p.type,
  title: p.title,
  content: p.content,
  version: p.version,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
})

export const findPolicy = (type) => prisma.policy.findUnique({ where: { type } })

export const listPolicies = () =>
  prisma.policy.findMany({ orderBy: { type: 'asc' } })

// A missing table means scripts/add-policies.js has not been run on this
// database yet. Said plainly in the log rather than as a bare Prisma error.
export const isMissingTable = (e) => e?.code === 'P2021'
export const MISSING_TABLE_HINT = 'policies table missing. Run: node scripts/add-policies.js'
