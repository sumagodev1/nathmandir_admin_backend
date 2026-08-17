// ─────────────────────────────────────────────────────────────
// Content schedule helpers — Morning / Afternoon × Mon–Sun.
//
// The admin form sends and receives one plain object:
//
//   { morning: ['mon','tue'], afternoon: ['wed'] }
//
// while the database stores one row per (item, session, day) in
// `content_schedule`. These two functions are the only place that
// translation happens, so no controller has to hand-roll it.
//
// "None" is the absence of rows, not a value: an item with an empty
// object on both sides is simply unscheduled.
// ─────────────────────────────────────────────────────────────

export const SESSIONS = ['morning', 'afternoon']
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

// The admin panel sends short codes, but a hand-written API call or a CSV
// import is just as likely to say "Monday". Accept both rather than
// rejecting input that is perfectly unambiguous.
const DAY_ALIASES = {
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu',
  friday: 'fri', saturday: 'sat', sunday: 'sun',
}

const normalizeDay = (d) => {
  const k = String(d || '').trim().toLowerCase()
  return DAY_ALIASES[k] || k
}

// DB rows → { morning: [...], afternoon: [...] }, days always in week order
// so the form's tick boxes never render out of sequence.
export function groupSchedule(rows = []) {
  const out = { morning: [], afternoon: [] }
  for (const r of rows) {
    if (out[r.session]) out[r.session].push(r.day)
  }
  for (const s of SESSIONS) {
    out[s].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b))
  }
  return out
}

// { morning: ['mon'], afternoon: [] } → [{ session, day }, ...]
//
// Returns { rows } on success or { error } on bad input. Duplicates inside
// one session are collapsed here; the unique key on the table is the
// backstop, not the first line of defence.
export function parseSchedule(input) {
  if (input === null || input === undefined) return { rows: [] }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'schedule must be an object like { morning: ["mon"], afternoon: [] }.' }
  }

  const rows = []
  for (const session of Object.keys(input)) {
    const key = String(session).trim().toLowerCase()
    if (!SESSIONS.includes(key)) {
      return { error: `Unknown session "${session}". Use ${SESSIONS.join(' or ')}.` }
    }
    const value = input[session]
    if (value === null || value === undefined) continue
    if (!Array.isArray(value)) {
      return { error: `schedule.${key} must be an array of days.` }
    }

    const seen = new Set()
    for (const raw of value) {
      const day = normalizeDay(raw)
      if (!DAYS.includes(day)) {
        return { error: `Unknown day "${raw}" in ${key}. Use ${DAYS.join(', ')}.` }
      }
      if (seen.has(day)) continue
      seen.add(day)
      rows.push({ session: key, day })
    }
  }
  return { rows }
}
