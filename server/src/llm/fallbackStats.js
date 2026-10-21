/**
 * fallbackStats.js — in-memory record of LLM replies for observability (no transcripts, no reply text).
 * Every runChain result is recorded as {fallback, reason, latency_ms}; the last hour feeds GET /api/health/llm
 * and an hourly "[llm] fallback rate" log line.
 * reason: timeout | api_error:<status> | validation:<rule> | safety | empty (null for a model reply).
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_EVENTS = 5000;
const events = [];

function prune(now = Date.now()) {
  while (events.length && (now - events[0].at > WINDOW_MS || events.length > MAX_EVENTS)) events.shift();
}

function record({ fallback, reason = null, latencyMs = null, stage = null }, now = Date.now()) {
  events.push({ at: now, fallback: !!fallback, reason: fallback ? reason || 'unknown' : null, latency_ms: latencyMs, stage });
  prune(now);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** Last-hour summary: {window_minutes, total, fallbacks, fallback_rate, top_reasons[{reason, count}], p50_ms, p95_ms}. */
function summary(now = Date.now()) {
  prune(now);
  const total = events.length;
  const fallbacks = events.filter(e => e.fallback);
  const counts = {};
  for (const e of fallbacks) counts[e.reason] = (counts[e.reason] || 0) + 1;
  const top_reasons = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
  const latencies = events.map(e => e.latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    window_minutes: WINDOW_MS / 60000,
    total,
    fallbacks: fallbacks.length,
    fallback_rate: total ? Number((fallbacks.length / total).toFixed(3)) : 0,
    top_reasons,
    p50_ms: percentile(latencies, 50),
    p95_ms: percentile(latencies, 95),
  };
}

function reset() {
  events.length = 0;
}

let timer = null;
/** Logs the last-hour fallback rate once an hour (only when there was traffic). */
function startHourlyLog(intervalMs = WINDOW_MS) {
  if (timer) return timer;
  timer = setInterval(() => {
    const s = summary();
    if (s.total) console.log('[llm] fallback rate (last hour):', JSON.stringify(s));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

function stopHourlyLog() {
  clearInterval(timer);
  timer = null;
}

module.exports = { record, summary, reset, startHourlyLog, stopHourlyLog, WINDOW_MS };
