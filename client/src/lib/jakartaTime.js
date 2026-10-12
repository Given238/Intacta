/**
 * Routine times are wall-clock Asia/Jakarta (the server scheduler uses the same clock), so "today" and
 * "now" for routines come from Intl with that timeZone, never the phone's own timezone.
 */
export const ROUTINE_TIME_ZONE = 'Asia/Jakarta'

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const format = new Intl.DateTimeFormat('en-US', {
  timeZone: ROUTINE_TIME_ZONE, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
})

/** {weekday 0=Sun..6=Sat, minutes since midnight} in Asia/Jakarta. */
export function jakartaClock(date = new Date()) {
  const p = Object.fromEntries(format.formatToParts(date).map(x => [x.type, x.value]))
  return { weekday: WEEKDAYS[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) }
}
