/**
 * storedSafety.js — the stored safety verdicts of context_items and routines (migration 008).
 *
 * A row is usable (sent to the terminal, used in a prompt, spoken) ONLY when it was screened with the current
 * SAFETY_VERSION and allowed. Older rows are re-screened with the classifier on server start and lazily on read;
 * until a verdict exists they are left out (fail closed) and the portal shows them as pending.
 * AI replies are never classified (latency): the pipeline relies on these stored verdicts.
 */

const { query } = require('../db/query');
const { checkPatientFacingText, checkFields, storedVerdict, SAFETY_VERSION } = require('./contentSafety');

const inflight = new Map(); // one re-screen per row at a time

function once(key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
}

const isCurrent = (row) => row?.safety_version != null && Number(row.safety_version) === SAFETY_VERSION;
const isUsable = (row) => isCurrent(row) && row.safety_verdict === 'allow' && !row.blocked_category;

/** Adds safety_pending for the portal (no verdict for the current version yet). */
const withPending = (row) => ({ ...row, safety_pending: !isCurrent(row) });

/** Re-screens one stored context item and saves the verdict. Returns the row (unchanged when no verdict). */
function rescreenContextItem(item) {
  return once(`context:${item.id}`, async () => {
    try {
      const v = storedVerdict(await checkPatientFacingText(item.text, { kind: 'context' }));
      await query(
        `UPDATE context_items SET safety_version = $1, safety_verdict = $2, safety_score = $3, blocked_category = $4, sensitive = $5
         WHERE id = $6`,
        [v.safety_version, v.safety_verdict, v.safety_score, v.blocked_category, v.sensitive, item.id]
      );
      if (v.blocked_category) console.warn(`[safety] context item ${item.id} blocked on re-screen (${v.blocked_category})`);
      return { ...item, ...v };
    } catch (err) {
      console.warn(`[safety] context item ${item.id} not re-screened: ${err.message}`);
      return item;
    }
  });
}

/** Re-screens one stored routine's spoken fields (title, audio_script, display_text) and saves the verdict. */
function rescreenRoutine(r) {
  return once(`routine:${r.id}`, async () => {
    try {
      const { sensitive: _s, ...v } = storedVerdict(
        await checkFields([r.title, r.audio_script, r.display_text], { kind: 'routine' }));
      await query(
        `UPDATE routines SET safety_version = $1, safety_verdict = $2, safety_score = $3, blocked_category = $4 WHERE id = $5`,
        [v.safety_version, v.safety_verdict, v.safety_score, v.blocked_category, r.id]
      );
      if (v.blocked_category) console.warn(`[safety] routine ${r.id} blocked on re-screen (${v.blocked_category})`);
      return { ...r, ...v };
    } catch (err) {
      console.warn(`[safety] routine ${r.id} not re-screened: ${err.message}`);
      return r;
    }
  });
}

/**
 * Brings rows up to the current version. wait=false starts the re-screen in the background and returns the rows
 * as they are (callers on the reply path must not wait for the classifier).
 */
async function ensureScreened(rows, rescreen, { wait = true } = {}) {
  const stale = rows.filter(r => !isCurrent(r));
  if (!stale.length) return rows;
  if (!wait) {
    for (const r of stale) rescreen(r).catch(() => {});
    return rows;
  }
  const done = new Map();
  for (const r of stale) done.set(r.id, await rescreen(r)); // sequential: friendlier to the API quota
  return rows.map(r => done.get(r.id) || r);
}

/** Server start: re-screen every current context item (today's daily + permanent) and every routine. */
async function rescreenAllStale() {
  try {
    const items = await query(
      `SELECT id, text, safety_version FROM context_items
       WHERE (safety_version IS NULL OR safety_version <> $1)
         AND ((scope = 'daily' AND context_date = CURRENT_DATE) OR scope = 'permanent')`,
      [SAFETY_VERSION]
    );
    const routines = await query(
      `SELECT id, title, audio_script, display_text, safety_version FROM routines
       WHERE safety_version IS NULL OR safety_version <> $1`,
      [SAFETY_VERSION]
    );
    await ensureScreened(items.rows, rescreenContextItem);
    await ensureScreened(routines.rows, rescreenRoutine);
    if (items.rows.length || routines.rows.length) {
      console.log(`[safety] re-screened ${items.rows.length} context item(s) and ${routines.rows.length} routine(s) (v${SAFETY_VERSION})`);
    }
  } catch (err) {
    console.error('[safety] start-up re-screen failed:', err.message);
  }
}

module.exports = { isCurrent, isUsable, withPending, rescreenContextItem, rescreenRoutine, ensureScreened, rescreenAllStale };
