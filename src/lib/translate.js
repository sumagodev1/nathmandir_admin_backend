// ── Translation helper ────────────────────────────────────────
// Turns one-language admin input into the full { en, hi, mr } shape
// the website expects, at SAVE time. Uses the free MyMemory API
// (no key needed; set MYMEMORY_EMAIL in .env to raise the daily quota).
//
// It ONLY translates "localized" fields — objects whose keys are a
// subset of { en, hi, mr }. Structural strings (slug, iconKey, image
// paths, links, role keys, numbers) are left untouched.
//
// It NEVER throws: on any network/quota error it falls back to the
// source text, so saving content always succeeds.

const LANG_KEYS = ['en', 'hi', 'mr']
const cache = new Map()

const isLocalized = (o) =>
  o &&
  typeof o === 'object' &&
  !Array.isArray(o) &&
  Object.keys(o).length > 0 &&
  Object.keys(o).every((k) => LANG_KEYS.includes(k))

const sourceValue = (o, lang) => o[lang] ?? o.en ?? o.mr ?? o.hi ?? ''

// Split long text into <=450-char chunks on sentence/word boundaries
// (MyMemory rejects very long queries).
function chunkText(text, max = 450) {
  if (text.length <= max) return [text]
  const parts = []
  let rest = text
  while (rest.length > max) {
    let cut = rest.lastIndexOf('. ', max)
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max)
    if (cut < max * 0.5) cut = max
    parts.push(rest.slice(0, cut + 1))
    rest = rest.slice(cut + 1)
  }
  if (rest) parts.push(rest)
  return parts
}

async function mymemory(text, from, to, email) {
  const emailParam = email ? `&de=${encodeURIComponent(email)}` : ''
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}${emailParam}`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  const out = data?.responseData?.translatedText
  if (
    res.ok &&
    out &&
    String(data.responseStatus) === '200' &&
    !/MYMEMORY WARNING|INVALID|QUERY LENGTH|CANNOT/i.test(out)
  ) {
    return out
  }
  throw new Error('translation unavailable')
}

async function translateOne(text, from, to) {
  if (!text || !text.trim() || from === to) return text
  const ck = `${from}|${to}|${text}`
  if (cache.has(ck)) return cache.get(ck)
  try {
    const pieces = chunkText(text)
    const parts = []
    for (const p of pieces) parts.push(await mymemory(p, from, to, process.env.MYMEMORY_EMAIL))
    const joined = parts.join('')
    cache.set(ck, joined)
    return joined
  } catch {
    return text // graceful fallback: keep the source text
  }
}

// Run async workers over items with a small concurrency cap.
async function pool(items, size, worker) {
  const queue = items.map((item, i) => [item, i])
  const runners = Array.from({ length: Math.min(size, items.length || 1) }, async () => {
    while (queue.length) {
      const [item] = queue.shift()
      await worker(item)
    }
  })
  await Promise.all(runners)
}

function collectStrings(node, sourceLang, out) {
  if (isLocalized(node)) {
    const src = sourceValue(node, sourceLang)
    if (src) out.add(src)
    return
  }
  if (Array.isArray(node)) return node.forEach((n) => collectStrings(n, sourceLang, out))
  if (node && typeof node === 'object') return Object.values(node).forEach((v) => collectStrings(v, sourceLang, out))
}

// Gather previous localized fields keyed by their source-language value, so
// unchanged text keeps its (possibly hand-curated) translations on re-save.
function collectPrev(node, sourceLang, map) {
  if (isLocalized(node)) {
    const src = sourceValue(node, sourceLang)
    if (src && node.en && node.hi && node.mr) map.set(src, { en: node.en, hi: node.hi, mr: node.mr })
    return
  }
  if (Array.isArray(node)) return node.forEach((n) => collectPrev(n, sourceLang, map))
  if (node && typeof node === 'object') return Object.values(node).forEach((v) => collectPrev(v, sourceLang, map))
}

function rebuild(node, sourceLang, map) {
  if (isLocalized(node)) {
    const src = sourceValue(node, sourceLang)
    return map.get(src) || { en: src, hi: src, mr: src }
  }
  if (Array.isArray(node)) return node.map((n) => rebuild(n, sourceLang, map))
  if (node && typeof node === 'object') {
    const o = {}
    for (const [k, v] of Object.entries(node)) o[k] = rebuild(v, sourceLang, map)
    return o
  }
  return node
}

// Translate every localized field of `data` from `sourceLang` into all
// three languages, returning a new structure with { en, hi, mr } fields.
// `prevData` (the previously stored section) lets unchanged source text
// keep its existing translations — so only edited fields hit the API.
export async function localizeSection(data, sourceLang = 'en', prevData = null) {
  const strings = new Set()
  collectStrings(data, sourceLang, strings)

  const targets = LANG_KEYS.filter((l) => l !== sourceLang)
  const map = new Map()

  // Reuse unchanged translations from the previous version.
  if (prevData) collectPrev(prevData, sourceLang, map)

  const toTranslate = [...strings].filter((s) => !map.has(s))

  await pool(toTranslate, 6, async (src) => {
    const entry = { [sourceLang]: src }
    await Promise.all(
      targets.map(async (to) => {
        entry[to] = await translateOne(src, sourceLang, to)
      })
    )
    map.set(src, entry)
  })

  return rebuild(data, sourceLang, map)
}
