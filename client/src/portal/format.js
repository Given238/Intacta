/**
 * Portal display formats (Figma style).
 */

/** Date or minutes-since-midnight → "08:00 A.M" (12-hour, suffixes from portal.home.am/pm). */
export function formatClock(value, t) {
  const mins = value instanceof Date ? value.getHours() * 60 + value.getMinutes() : value
  const h24  = Math.floor(mins / 60) % 24
  const h12  = h24 % 12 || 12
  const pad  = (n) => String(n).padStart(2, '0')
  return `${pad(h12)}:${pad(mins % 60)} ${t(h24 < 12 ? 'portal.home.am' : 'portal.home.pm')}`
}

/** "08:00:00" (Postgres TIME) → minutes since midnight */
export function timeToMinutes(time) {
  const [h, m] = String(time).split(':').map(Number)
  return h * 60 + (m || 0)
}
