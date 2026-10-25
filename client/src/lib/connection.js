/**
 * connection — the terminal's caregiver connection state for the header chip ("Connected · {name}").
 *
 * {paired, name, count}: name = the most recently paired caregiver (null → "Caregiver"), count = team size.
 * The last known state is kept in localStorage (`terminal_connection`, nothing sensitive) so the first paint after a
 * reload is right; the server then reconciles it (GET /api/device/context, device:paired, caregiver:updated).
 */
const KEY = 'terminal_connection'

export const UNPAIRED = Object.freeze({ paired: false, name: null, count: 0 })

const clean = (name) => (typeof name === 'string' && name.trim() ? name.trim() : null)

/** From a server payload: device:paired {caregiver_name, caregiver_count}, caregiver:updated {name, count}, context. */
export function fromServer({ name, caregiver_name, count, caregiver_count } = {}, { paired } = {}) {
  const n = Number(count ?? caregiver_count) || 0
  const isPaired = paired ?? n > 0
  if (!isPaired) return UNPAIRED
  return { paired: true, name: clean(name ?? caregiver_name), count: Math.max(1, n) }
}

export function loadConnection() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY))
    return s?.paired ? fromServer(s, { paired: true }) : UNPAIRED
  } catch {
    return UNPAIRED
  }
}

export function saveConnection(state) {
  try {
    if (state?.paired) localStorage.setItem(KEY, JSON.stringify({ paired: true, name: state.name, count: state.count }))
    else localStorage.removeItem(KEY)
  } catch { /* storage unavailable: the server state still applies */ }
}

/**
 * Chip text: {text, main, more, full}. One caregiver: "Connected · Budi Santoso"; several: "Connected · Budi +2"
 * (first name only). The chip renders `main` (truncates with an ellipsis) and `more` ("+2", never truncated);
 * `text` is the whole visible string, `full` the accessible label with the whole name.
 */
export function chipText(t, { name, count }) {
  const display = clean(name) || t('connected.fallbackName')
  const others = Math.max(0, (count || 1) - 1)
  const first = display.split(' ')[0]
  const short = others ? t('connected.more', { name: first, count: others }) : display
  const more = others ? short.slice(short.lastIndexOf(' +') + 1) : null // "+2"
  return {
    text: t('connected.label', { name: short }),
    main: t('connected.label', { name: others ? first : display }),
    more,
    full: others ? t('connected.fullMore', { name: display, count: others }) : t('connected.full', { name: display }),
  }
}
