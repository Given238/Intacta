# Intacta — Progress Status

Last updated: 2026-10-21
Branch: `wip-recovery` (Phase 3 terminal + 3a/3b backend committed in `ccba0fc`; portal C1–C2 committed per screen)

---

## Phase Status Summary

| Phase | Name | Status | Evidence |
|-------|------|--------|----------|
| P0 | Audit fixes, env config, deploy files | **DONE** | `001_initial.sql`, `src/config/env.js`, `Dockerfile`, `render.yaml` |
| P1 | DB + JWT REST + Socket.IO sync | **DONE** | REST routes, `src/socket/index.js`, auth middlewares, `src/services/audit.js` |
| P2 | LLM engine (validator, fallbacks, /api/respond, guardrail tests, llm:try) | **DONE, with 2 fixes in 3b** | Prompt template + retry bugs fixed in 3b (see below) |
| P3a | Backend glue for the terminal | **VERIFIED 2026-10-10** | `src/__tests__/backend-3a.test.js` |
| P3b | Backend for the new Figma (context items, settings, status, interactions, broadcast, voice test) | **CODE + UNIT TESTS DONE; migration/seed NOT RUN** | `src/__tests__/backend-3b.test.js`; no Postgres on the dev machine |
| P3 | Patient Terminal UI (`/terminal`) | **IN PROGRESS** | Screens build; client still uses the old contract (see Known bugs) |
| P4 | Caregiver Portal | **IN PROGRESS** | All portal screens built (`client/src/portal/`): pair, Home, Context, Patient, Routines, Settings; see "Portal C2" |
| P5 | Voice loop | **CODE DONE, NOT VERIFIED ON TABLET** | Parts A (audio out) + B (mic → server STT) 2026-10-12, branch `phase-5-voice`; STT + TTS latency targets missed. See "Voice and routines" |
| P6 | Routines scheduler, broadcast, settings, EN/ID | **PARTIAL** | Routine scheduler done 2026-10-12 (Part C); broadcast + settings + portal UI done; EN/ID not verified end to end |
| P7 | Resilience, deploy, demo seed | **PARTIAL** | Seed rewritten for Figma (not executed); not deployed |

---

## Phase 3b (2026-10-10)

### Done
- **Migration** `src/migrations/003_figma_model.sql` (idempotent): `context_items`, `routines.title` + `routines.days SMALLINT[]`
  (default all days, 0=Sun..6=Sat), `patient_settings` (range CHECKs), `devices.name`. Copies today's legacy
  `daily_contexts` rows into `context_items`. `001_initial.sql` `CREATE TYPE` made re-runnable (migrate.js re-runs every file).
- **REST** (caregiver JWT, ownership 403/404 via `src/services/ownership.js`):
  `/api/context-items` CRUD (`routes/contextItems.js`), `GET/PUT /api/settings` (`routes/settings.js`),
  `GET /api/patient/status` + `GET /api/interactions` cursor-paged (`routes/patient.js`), routines take `title`/`days`.
  Terminal: `GET /api/device/context`, `GET /api/device/settings` (`routes/device.js`). Zod on bodies and query strings.
- **Removed** legacy `GET/PUT /api/context`, `contextController.js`, socket `context:update` (context writes are REST only).
- **Socket** (`src/socket/index.js`): non-volatile `context:sync` / `settings:sync` on every change, on terminal connect
  and on pairing; `broadcast:message` (ownership, ≤200 chars, logged source=broadcast, audited, `interaction:new`);
  `voice:test` (sends voice settings + language-appropriate test phrase).
- **LLM**: `prompts.js` builds from today's daily + permanent items; per-patient word cap
  `min(25, round(max_speech_seconds × 2.5))`, 0 → 25, enforced in `chain.js` after the unchanged validator.
  `strict_validation` is never read by the pipeline (guardrails always on). Validator and fallbacks untouched.
- **Seed** (`src/db/seed.js`): Timothy Eugene / Eleanor Vance (en) / "Tablet - Ruang Tamu", 2 daily + 1 permanent items,
  routines 08:00 Breakfast & Morning Meds, 12:30 Lunch Time, default settings.
- **Pre-existing bugs fixed on the way**:
  - `src/config/db.js` threw on require (`dialect.createQueryCompiler is not a function`): the server, migrate and seed
    could not start. Now a pg Pool with a real Kysely `PostgresDialect` on `pool.db`.
  - `prompts.js`: the JSON example in the system prompt was parsed as template variables, so **every real LLM call
    failed and returned a fallback**. Braces are now escaped.
  - `chain.js`: the retry referenced `prompt` out of scope (ReferenceError → always fallback) and ran without a timeout.
    Retry now works and shares the 1.2 s budget.

### Verification
- `cd server && npm test` → **4 suites, 156 passed** (87 LLM tests unchanged + 23 backend-3a + 46 backend-3b).
- Server boots; `/health` 503 without DB, unknown `/api/*` 404, unauthenticated 401, zod 400 with field errors.
- All migrations and every SQL statement issued by the new services/seed parse with the Postgres parser (libpg-query).
- **Not verified**: running migration 003 and the seed against a real Postgres (none installed locally).

---

## Public code-only pairing (2026-10-10)

### Done
- `POST /api/devices/pair` is public (`optionalAuthenticate` in `middleware/auth.js`), still 5/min/IP.
  Logic in `src/services/pairingService.js`; controller is thin. No header → creates caregiver + patient
  (patient "Patient", language `id`); Bearer JWT → that caregiver's patient. Returns caregiver JWT +
  `{patient_id, language, device_name}`; emits `device:paired` + joins `patient:{id}` + `context:sync`/`settings:sync`; audited.
- Migration `004_public_pairing.sql`: `caregivers.email`/`password_hash` DROP NOT NULL (chosen over placeholder
  credentials: smaller, no fake emails), `devices.code_used_at`. Codes now SHA-256 instead of bcrypt so they can be
  looked up exactly and reported as 400 invalid / 410 expired / 409 used. Code claim is an atomic UPDATE (race → 409),
  released if linking fails.
- `authController.login`: 401 for caregivers with no password (was a bcrypt crash on NULL).

### Verification
- `npm test` → 4 suites, 166 passed (9 new pairing tests in `backend-3a.test.js`).
- `npm run migrate` ran 001–004 against the `DATABASE_URL` database. Live smoke: register → pair (200, JWT,
  `device_name: "Tablet"`) → reuse (409 `code_used`) → bad code (400) → bad JWT (401). Smoke rows deleted.

---

## Terminal "Enter Caregiver mode" error (2026-10-10)

**Root cause:** `POST /api/devices/register` failed twice over: the Vite dev proxy forwarded `/api` and `/socket.io` to
`:3001` while the server listens on `:3000` (proxy ECONNREFUSED → 500), and behind that no Postgres is running on
`localhost:5432` (pg `AggregateError ECONNREFUSED` with an empty message → generic 500 "Failed to register device").

### Diagnosis (raw)
- `GET :3000/health` → `503 {"status":"degraded","db":"disconnected"}`
- `POST :3000/api/devices/register` → `500 {"error":"Failed to register device"}`; log `registerDevice error: ` (empty message)
- `:3001` → connection refused. No Postgres service/binaries, no Docker, no WSL distro on this machine.
- No `client/.env` (`VITE_API_URL` unset → same-origin via the Vite proxy, which is correct in dev).
- CORS is not the problem: the server answers with `access-control-allow-origin: *` for the Vite origin. Route is public.
- `npm run migrate` → ECONNREFUSED (cannot run without Postgres).

### Fixed
- `client/vite.config.js`: proxy target defaults to `http://localhost:3000` (override with `VITE_PROXY_TARGET`).
- `devicesController.registerDevice`: logs error code + stack; unreachable DB → `503 {error, code:"db_unavailable"}`,
  other failures → `500 {code:"register_failed"}`. Test added (157 tests pass).
- `client/src/App.jsx`: register fetch uses `VITE_API_URL` as base; error text is `register failed: <status> (<code>)`
  or `register failed: network (...)`. `pages/Home.jsx` shows that text when `import.meta.env.DEV`, else the
  friendly i18n `error` string. No design changes.
- Verified via Vite (`:5173/api/devices/register`) → `503 db_unavailable` reaching the real server.

### Still blocking
- **Postgres is needed** for register to succeed: install Postgres 16 locally (or use a hosted DB in `DATABASE_URL`),
  then `npm run migrate` and `npm run db:seed` in `server/`.

---

## Terminal x-device-token helper (2026-10-11)

### Done
- `client/src/lib/terminalApi.js`: `terminalFetch(path, opts)` is the single place that adds `x-device-token` (from
  `localStorage.device_token`) and the `VITE_API_URL` base. Throws `TerminalApiError {status, code}`; message is
  `<status> <server error> (<code>)`. Missing token → `code: no_device_token`, no request sent.
- `App.jsx`: typed input (`/api/respond`) and the `device:paired` handler (`/api/patients/me`) use it. Typed input shows
  i18n `notRegistered` ("Terminal not registered, tap Authentication code") when there is no token; other errors show
  `respond failed: <status> <server error>` in dev, the generic `error` string in prod. No longer requires a socket.
- The client does not call `/api/device/context`, `/api/device/settings` or `/api/tts` yet; use `terminalFetch` when it does.

### Verification
- `npx vite build` OK. The helper, bundled and run against the live backend via the Vite proxy: no token →
  `no_device_token`, bad token → `401 Invalid device token`, paired token → **200** (header fix confirmed).
- **Reply does NOT appear** ("Where is Timothy?"): 200 body is `{meta:{fallback:true,theme:"disorientation"}}`
  with no `text`/`parts`. See known bugs 11 and 12. Test device/patient/caregiver rows were deleted afterwards.

---

## Terminal Response crash + typed-input ref + error boundary (2026-10-11)

### Done
- `pages/Response.jsx`: aligned with the server shape `{text, parts[], meta:{fallback, theme, latency_ms}}`. Uses `text`,
  else `parts.join(' ')`, else `''` → shows i18n `response.noText` ("I am here with you." / "Saya di sini bersama Anda.").
  Never calls `.split` on undefined. Latency read from `meta.latency_ms` (was `response.latency_ms`, always undefined).
  `onDone` held in a ref so the highlight effect doesn't restart on parent re-renders; return-home timer cleared on unmount.
- `App.jsx` `TypedUtterance`: controlled input (`value` state, cleared with `setValue('')`); no DOM writes through the
  ref, which is only used with `?.` to focus.
- `App.jsx` `TerminalErrorBoundary` around the terminal `<Routes>`: friendly i18n message (`errorBoundary.message`) +
  "Back to home" button (`errorBoundary.home`) that resets the boundary and navigates to `/terminal`.

### Verification
- `npx vite build` OK. Headless Chrome (CDP, own profile) against the live backend + Vite with a throwaway paired device,
  `/terminal?dev=1`, typed "Where is Timothy?": `/terminal/response` after ~2.3 s, words lit 1→5 of 5, back on
  `/terminal` ~3.5 s after the last word, input cleared, **no exceptions or console errors**.
- **The text shown was the client fallback "I am here with you."**, not an LLM reply: the server still returns no
  `text` (known bugs 11 + 12). The error boundary was not triggered in the test (no crashing screen left to trigger it).
- Debug overlay showed `lang en` for an `id` patient: terminal language is never updated on pairing (part of item 8).
- Test rows deleted afterwards.

---

## LLM always falls back: diagnosis (2026-10-11)

### Root cause
Gemini returns **404 "models/gemini-2.5-flash-lite is no longer available to new users"** (suggests
`gemini-3.5-flash-lite`). Key is set (`gemini_api_key_set: true`), no 429, no schema error. The retry then hangs until the
1.2 s budget aborts it (retrying a 404 is pointless). Checked and ruled out:
- `thinkingConfig` is silently ignored by the installed `@langchain/google-genai@0.1.12` (no support in its dist).
  On 3.5-flash-lite `thinkingBudget: 0` is rejected (400), but the model reports 0 thought tokens anyway.
- `GEMINI_MODEL` / `LLM_TIMEOUT_MS` were declared in `config/env.js` and `.env` but **never read**: model and timeout
  were hardcoded.

### Done
- `llm/chain.js`: `logFallback()` (skipped when `NODE_ENV=production`) prints stage, error name, message (key value
  redacted if it ever appears), HTTP status, `gemini_api_key_set` true/false. `TIMEOUT_MS` reads `LLM_TIMEOUT_MS`
  (default 1200). Abort detection was case-sensitive (`'aborted'` vs the real `"Aborted"`), so timeouts were treated
  as errors and "retried" on a dead signal; now `/abort/i`.
- `llm/model.js`: model from `GEMINI_MODEL` (default still `gemini-2.5-flash-lite`).
- `llm/cli.js`: uses `runChain` (same pipeline as `/api/respond`, incl. the debug log) and prints `text`/`parts`,
  built from `validate/reassure/redirect` for fallbacks. No more `undefined`.
- `.env` and CLAUDE.md **not** changed (model is pinned there; needs a decision).

### Verification
- `npm test` → 4 suites, 166 passed.
- `gemini-3.5-flash-lite` (env override, direct calls, with context): 6/6 valid replies, **1075–1391 ms**; one invented
  "Timothy is at school" despite context saying work. Through `runChain` with 1.2 s: 3/3 timed out → fallback.
  With `LLM_TIMEOUT_MS=2500`: 3/4 LLM replies at 1552–1668 ms (EN + ID), 1 rejected by the validator (26 words) and the
  retry ran out of time.
- With no context (CLI), the model invented "Timothy is safe at work today" instead of a generic phrase (FR-4.3.5).

## Clinical fix: no invented facts (2026-10-11)

### Done
- `src/llm/prompts.js` (EN + ID system prompts): `reassure` may only state facts written in the daily/permanent
  context items. Never invent a person's whereabouts, arrival time, activity, or any name/relationship. If the
  context does not answer the utterance (or is empty), `reassure` is a general true comfort ("You are safe, and I am
  here with you." / "Kamu aman, dan aku di sini bersamamu."). No assumed gender/title/name for the patient
  ("you"/"kamu"). Validator, fallbacks, model.js unchanged.
- `src/llm/__tests__/factuality.test.js`: offline prompt-content checks (always run) and live-model cases, gated by
  `LIVE_LLM=1` (`cd server && LIVE_LLM=1 npx jest factuality`). Live cases 3x per language: (a) no context +
  "Where is Timothy?" / "Timothy di mana?" → no forbidden patterns (kamar, sebelah, istirahat, "<name> sedang",
  room, resting, on his way, work, times, soon/later, coming/pulang, son/anak, Ibu/Bapak/Mom/...);
  (b) context "Timothy (son) comes home at 5.00 P.M" → no invented place/activity/relationship/title, and no time
  other than 5 / 5.00 / 17.00. Live runs force a ~8 s budget (`LIVE_LLM_TIMEOUT_MS`) so slow calls are not masked
  by a fallback; a fallback fails the test.

### Verification
- `npm test` → 5 suites, 170 passed, 12 skipped (the live cases).
- `LIVE_LLM=1 npx jest factuality` (gemini-3.5-flash-lite) → 16/16 passed, 12/12 live replies were LLM output (no
  fallback). No context: every reassure was exactly the general comfort sentence, no title. With context: every reply
  stated "Timothy comes home at 5 PM" (EN) / "pulang pukul lima sore" (ID) and nothing else.
  First live run (before the test budget fix): EN no-context 2/3 fell back on "Aborted" at ~1-2 s although
  `.env` has `LLM_TIMEOUT_MS=4000` (unexplained, see item 17).

---

## Portal C1a: pairing screen + app shell (2026-10-11)

### Done
- `client/src/main.jsx` mounts `portal/PortalApp.jsx` for any `/portal*` path, otherwise the terminal `App` (separate
  apps on one origin; the "back to patient page" link does a full load of `/terminal`).
- `/portal/pair` = Figma 62:171 (`portal/pages/Pair.jsx`): code input (A-Z/0-9, uppercase, shown `XXX - XXX`),
  Confirm → `POST /api/devices/pair {code}` (`portal/portalApi.js`). Success stores `{token, patient_id, language,
  device_name}` in localStorage `portal_session` (`portal/session.js`) and goes to `/portal`. Errors map
  `invalid_code`/`code_required`, `code_expired`, `code_used`, `rate_limited`, network, other → toast styled like the
  terminal's (`portal/components/PortalToast.jsx`), auto-hides after 5 s.
- Shell (`PortalApp.jsx`): `PortalHeader` (logo/brand/tagline, clipped to the viewport) + bottom `TabBar`
  (Home, Patient, Routines, Context, Settings; Lucide icons; 64px + safe-area-inset-bottom; active tab on `#05668d`).
  Content area padded by the bar height. Tabs render `portal/pages/Placeholder.jsx`.
- Guard: every `/portal/*` route except `/portal/pair` redirects to `/portal/pair` without a stored session;
  unknown `/portal/*` → `/portal`. No tab bar on the pair screen.
- Strings under `portal.*` in `client/src/i18n/{en,id}.json`. Logo reuses `assets/logo.svg` (identical paths to Figma
  62:175); divider exported from Figma as `assets/portal-divider.svg`.
- `client/index.html` viewport gets `viewport-fit=cover` so `env(safe-area-inset-*)` is non-zero on iOS.

### Verification
- `npx vite build` passes; `oxlint` clean on `src/portal` + `main.jsx`.
- Headless Chrome at 402×874 (CDP): `/portal/settings` without session → `/portal/pair`; input `ab3k9z` shows
  `AB3 - K9Z`; real server returned 400 → "not valid" toast; stubbed 200 → body `{"code":"DEVD4Y"}`, session stored,
  lands on `/portal` with Home active; with a session `/portal/routines` shows the shell, Routines active,
  tab targets 52×74, no horizontal scroll. Not tested on a real phone or with a real successful pair.

### Notes
- Fonts: Figma uses Montserrat (title, "Enter code:") and Baloo 2; per the brief the portal reuses the terminal's
  Inter 800 and Baloo Da 2 800 instead (no new font packages).
- Portal UI language still follows the shared i18n instance (`terminal_language`, default en); the per-user toggle
  belongs to the Settings screen. The pair request sends no Authorization header ("Pair New Tablet" comes later).
- Tailwind v4 ignores the `--font-family-*` theme names, so portal code uses `[font-family:var(--font-family-…)]`.

## Portal C1b: Home screen (2026-10-11)

### Done
- `client/src/portal/pages/Home.jsx` = Figma 29:42: today's date (locale-formatted), Caregiver card ("Shift: <name>"),
  Patient card, Daily context bar (first daily item; whole bar links to `/portal/context`, chevron on the right),
  Schedule card (today's active routines: `is_active`, `days` includes today's weekday or `days` is NULL, sorted by
  `trigger_time`; "HH:MM - title", falling back to `display_text` then the category name; past times struck through as in Figma).
- Data: `GET /api/patient/status`, `GET /api/context-items?scope=daily`, `GET /api/routines`, in parallel via
  `portalFetch` (`portal/portalApi.js`, Bearer JWT from `portal_session`). Loading spinner, error card with "Try again",
  empty states "No notes for today yet" / "No routines scheduled". Missing names → "Caregiver" / "Patient".
- `portalFetch`: any 401 clears `portal_session` and does `location.replace('/portal/pair')`.
- Layout (`PortalApp.jsx`): whole portal is a centered column, full width on phones, max 480px on larger screens
  (backdrop `intacta-panel`); tab bar is fixed to the bottom of that column. Shell background is now `#427aa1` (Figma
  portal frames); the pair screen keeps its own `#164c67`.
- Inter weights: see "Portal typography" below (imports moved to `main.jsx`).
- Strings under `portal.home.*` in `client/src/i18n/{en,id}.json`.

### Verification
- `npx vite build` passes; `oxlint` clean on `src/portal`.
- Headless Chrome (CDP) with a stubbed `fetch`: all three calls carry `Bearer`; schedule drops the inactive and the
  other-weekday routine and sorts by time; chevron bar → `/portal/context`; empty data → both empty states and
  "Patient" fallback; 500 → error card, retry → data; 401 → `/portal/pair` with the session cleared; loading state
  shows; 1280×800 → 480px column centered, tab bar 480 wide at the column bottom. Not tested against the real
  backend with a real paired session.

### Notes / open
- **Caregiver name is always "Caregiver"**: no API returns it (`/api/patient/status` has no caregiver field and the pair
  response doesn't either). Home reads `status.caregiver_name` if the server ever adds it. Adding it is a backend change.
- The Figma Home header has a hamburger (drawer); per CLAUDE.md the drawer is not used, so the shell header is unchanged.
- Figma has no arrow on the Daily context bar; the chevron is Lucide `ChevronRight` (same icon the terminal imports).
- "Today" for routines uses the phone's local weekday/time; daily context uses the server's `CURRENT_DATE` (item 5).

## Portal typography (2026-10-11)

### Done
- The whole portal is Inter; only the "Intacta" wordmark is Baloo Da 2 ExtraBold (Figma 29:42).
- `client/src/main.jsx` imports `@fontsource/inter` 300, 400, 500, 600, 700, 800 (+ Baloo Da 2 400/800). The
  per-portal imports in `PortalApp.jsx` are gone.
- Shared text classes in `client/src/portal/portal.css` (family + weight only; size/color stay Tailwind):
  `.portal` (root font-family `"Inter", sans-serif`), `text-wordmark` (Baloo Da 2 800), `text-title-bold` (700),
  `text-title-semibold` (600), `text-body-medium` (500), `text-body-regular` (400), `text-body-light` (300).
  Plain CSS rather than Tailwind `@utility` so the global `index.css` stays untouched; unlayered, so they win over utilities.
- Used everywhere in the portal: header (wordmark, tagline medium), tab labels (semibold 12px), toast (medium),
  placeholders (title bold, body light), Pair, Home. No `[font-family:…]`/`font-bold`-style per-component fonts remain.
- Home, all 13px white: date + card titles bold, card values light, "Daily context"/"Schedule" semibold, daily text +
  routine rows light. Routine rows read `08:00 A.M - Title` (12-hour, suffixes `portal.home.am/pm` in en/id.json);
  rows already past today are struck through.
- Pair: Baloo Da 2 subtitle and Confirm switched to Inter (bold / semibold); Montserrat headings were already Inter, now
  bold 700 as in Figma; back link Inter Regular. Subtitle is 21px centered (Inter at 23px wrapped onto two lines).

### Verification
- `npx vite build` passes; `oxlint` clean on `src/portal` + `main.jsx`.
- Headless Chrome at 402×874, computed styles: date/card titles Inter 700 13px, card values + daily text + rows
  Inter 300 13px, "Daily context"/"Schedule" Inter 600 13px, past rows `line-through`, rows `08:00 A.M - …`,
  tab labels Inter 600, wordmark Baloo Da 2 800, tagline Inter 500; placeholder Inter 700/300; Pair all Inter.

## Portal C2: Context, Patient, Routines, Settings (2026-10-11, one commit per screen)

### DONE
- **Context** (`client/src/portal/pages/Context.jsx`, Figma 60:60): Daily (today) + Permanent lists from
  `GET /api/context-items`; trash per item with an inline Delete/Cancel confirm; "Add … context" pill + plus button,
  Enter submits. Optimistic add/delete with rollback + toast; failed add puts the text back. Validation: empty,
  case-insensitive duplicate, >200 chars (inline error; counter from 160). Empty states "No notes for today yet" /
  "No permanent notes yet". Icons exported from Figma: `assets/icons/trash.svg` (107:1627), `assets/icons/plus-circle.svg` (107:1634).
  No backend change (endpoints + ownership checks already existed).
- Shared for all portal screens: `portal/usePortalLoad.js` (load / error / retry), `portal/components/LoadState.jsx`
  (Loading, LoadError with retry, Empty, CARD), tab bar hides while a text field is focused and the field scrolls
  into view (`TabBar.jsx`; sliders/switches don't count).
- Verified live (backend on :3000 + Neon, throwaway paired tablet, rows deleted afterwards), headless Chrome 402×874:
  add daily via Enter, add permanent via plus, duplicate/empty/too-long errors, failed POST rolls back + keeps text,
  failed DELETE restores the row, real delete, reload shows server state. A socket.io client authenticated as the
  tablet received `context:sync` after every add/delete with the updated lists (the terminal's `App.jsx` puts that
  payload into its `context` state; the terminal does not persist it to localStorage).

- **Patient** (`portal/pages/Patient.jsx` + `portal/pages/InteractionLog.jsx`, Figma 60:120):
  - Status card: name, Online/Offline dot (Figma 60:540 green dot; grey CSS dot when offline), battery ring + %
    from `GET /api/patient/status`, updated live by `device:status` over the caregiver socket (`portal/usePortalSocket.js`,
    JWT in `auth.token`). "No tablet paired yet" when there is no device.
  - Speak bar: Figma's dark circle (60:4796) is the mic button (Web Speech dictation, `id-ID`/`en-US` from the patient's
    language, pulsing red ring while recording, disabled with a tooltip where unsupported); white field takes typed text;
    Enter or the send button emits `broadcast:message {patientId, text}` with an ack (5 s timeout). "Sent to the tablet"
    confirmation, 200-char check, offline/failed toasts.
  - Interaction Logs: `GET /api/interactions` (20 per page, "Load older" with `before`), live `interaction:new` prepended,
    day headers (Today / Yesterday / date). Row = time (Inter ExtraBold 19px, `text-display`) + 132×36 white pill.
    Audio rows (`audio_available` + `waveform_peaks`): 30 bars drawn from the peaks, playhead, played part tinted;
    tap = play/pause; clip fetched with the JWT as a blob (`portalFetchBlob`, `audio_url` or
    `/api/interactions/:id/audio`); one clip at a time; 404/410 → "Recording expired". Other rows: source icon + label.
    Tapping the time/chevron expands transcript + reply ("You sent" for broadcasts). The list scrolls inside the card,
    whose height is measured so it ends above the tab bar.
  - Terminal (`client/src/App.jsx`): `broadcast:message` navigates to `/terminal/response` with the text (voice in Phase 5).
- **Backend fix** (landed in commit `ccba0fc` with the Phase 3/3b backend): `server/src/socket/index.js` registered the caregiver's `broadcast:message`
  / `voice:test` handlers only after awaiting the patient-rooms query, so an event sent right after connecting was
  silently dropped (seen live: no ack). Handlers are now registered first. Test: `server/src/__tests__/portal-c2.test.js`
  (fails on the old code, passes now).
- Patient verified live (headless Chrome + throwaway tablet): status 73% arrived via `device:status`; a typed broadcast
  was acked, reached the tablet socket (`broadcast:message` + `interaction:new`), appeared live in the log, expanded to
  "You sent …", survived a reload; the real terminal page (`/terminal?dev=1`, paired as that tablet) switched to
  `/terminal/response` showing the text, then returned home. Waveform path tested with mocked rows + WAV blobs:
  play → pause icon, starting a second clip stops the first, pause, 410 → "Recording expired", Bearer sent on clip
  fetches, "Load older" appends and disappears at the end, card ends 142px above the tab bar.

- **Routines** (`portal/pages/Routines.jsx` + `portal/pages/RoutineForm.jsx`). Figma frame 60:30 only holds the header
  and the "enable all routines" label; the switch (93:202), chip (93:222), card (93:223), rows (93:254…), day letters
  (93:329…) and pen/trash icons sit on the page canvas around it and were read from there. Pen icon exported to
  `assets/icons/pen.svg` (93:251); trash and plus-circle reuse the Context exports (same components).
  - Chip "active: N / next: <title> at <time>" (next active routine later today, else "nothing else today");
    "enable all routines" switch PUTs `is_active` on every routine that differs (failures roll back individually).
  - Rows grouped Morning (<12:00) / Afternoon (<18:00) / Evening, sorted by time: time pill, title, per-row switch,
    pen (edit), trash (confirm dialog), tappable S M T W T F S (selected bold; last day can't be removed).
  - "+ Add routine" opens `RoutineForm` (title, time `HH:MM`, days, category meal/medication/hygiene, audio script),
    required-field + time-format validation with inline errors and focus on the first error. Create/update/delete/toggle
    are optimistic with rollback + toast. Shared `components/Switch.jsx` (M3 look) and `components/Dialog.jsx`
    (bottom sheet, Esc/backdrop close, focus in/out).
  - No backend change: `/api/routines` already checks ownership on every route.
  - Verified live: validation messages, typing keeps focus in the dialog, Esc closes, 3 routines created land in the
    right groups, row switch / day toggle / enable-all on-off persist, edit pre-fills and re-sorts, failed PUT rolls
    back with a toast, delete confirm, reload shows server state, Home's Schedule shows the changes (Sunday-disabled
    routine correctly hidden on a Sunday), at 402×600 the last row ends above the tab bar after scrolling.

- **Settings** (`portal/pages/Settings.jsx`, Figma 60:90 + canvas icons Bluetooth 107:86, Mic 107:1504,
  keyboard_arrow_up 107:1565 → `assets/icons/{bluetooth,mic,keyboard-arrow-up}.svg`; status dot reuses `status-dot-online.svg`).
  - Device Pairing: device name, Online/Offline dot + battery % (status + live `device:status`), "Pair New Tablet" →
    `/portal/pair?link=1`: the pair request then carries the JWT so the tablet joins the same patient; back link goes to
    Settings; an invalid stored JWT (401) clears the session and asks for the code again (`Pair.jsx`, `portalApi.pairWithCode`).
  - Clinical Rules: Strict Validation switch (turning it off opens a confirm dialog stating that questions / memory
    quizzing / corrections stay blocked regardless), Max Speech Duration slider 0–15 s ("No limit" at 0).
  - Audio: voice dropdown (Default / Indonesian voice / English voice from `GET /api/settings/voices`, plus "Custom
    voice" for an unknown stored id), playback speed 0.85–1.0x (0.05 steps), volume 60–70 dB, "Test Voice": tablet online
    → `voice:test` with ack (the terminal shows the text in its response view, `client/src/App.jsx`); offline or failed →
    browser `speechSynthesis` in the patient's language (rate = playback speed, 60–70 dB mapped to volume 0.5–1.0).
  - Account & Security: caregiver name + email (save on blur/Enter, inline validation, 409 → "already used"), Log Out
    (confirm dialog explaining a new tablet code is needed; clears the JWT → `/portal/pair`).
  - Recording notice line under the cards. Sliders save on release (pointer up / key up / blur), switches and the
    dropdown on change; per-card "Saving… / Saved" indicator; failures roll back with a toast. Saves are queued in order
    and only the newest reply is applied (found live: two fast slider steps could land out of order).
  - `components/Placeholder.jsx` removed (every tab is a real screen now).
- **Backend additions** (committed with the Settings screen):
  - `GET/PUT /api/caregiver` (own profile: name, email; zod `updateCaregiverSchema`; 409 `email_taken`; audited
    `caregiver.update`): `routes/caregiver.js`, `controllers/caregiverController.js`, `services/caregiverService.js`,
    mounted in `src/index.js`. Always scoped to the JWT's caregiver, so no cross-caregiver access is possible.
  - `GET /api/settings/voices` (caregiver JWT): configured `ELEVENLABS_VOICE_ID_ID` / `_EN` as `{language, id}`.
  - Tests: `server/src/__tests__/portal-c2.test.js` (6 tests). Full suite: 6 suites, 176 passed, 12 skipped.
- Settings verified live: strict off → confirm → saved (`settings:sync` with `strict_validation:false` reached the
  tablet socket) → back on; slider keyboard steps saved and synced (4 rapid steps → server 5, after the fix); volume
  saved; voices listed; Test Voice → tablet socket got `voice:test` and the real terminal page showed the phrase;
  forced-offline status → Indonesian `speechSynthesis` call with rate 1 / volume 0.80; name + email saved and
  reloaded, invalid email rejected inline; Pair New Tablet with a second registered tablet → back on Settings, same
  patient id; Log Out → `/portal/pair`, session cleared. No console errors.

### Needs manual testing (real devices)
- Phone keyboard: tab bar hides while typing and the focused field stays visible (Context inputs, Speak Now, dialogs).
- Web Speech dictation on Patient (Chrome Android / Safari iOS; needs HTTPS + mic permission) in id-ID and en-US.
- Browser speech fallback for Test Voice (real audio output; voices differ per OS).
- Waveform playback against a real audio backend (only mocked; the endpoint `/api/interactions/:id/audio` and the
  `audio_available` / `waveform_peaks` fields don't exist yet).
- Safe-area insets on a notched iPhone (header, tab bar, bottom-sheet dialogs).
- Pair New Tablet with a real second tablet; the first tablet keeps working in the same patient room.
- Range sliders by touch (commit on touchend/pointerup).

### Test data
- Live checks used a throwaway pairing (caregiver + patient + 2 devices on the `DATABASE_URL` DB); deleted afterwards.

### Known visual diffs
- All portal frames: the Figma header has a hamburger (drawer); the drawer is replaced by the tab bar, so no hamburger.
- Context: Figma's add pill is a fixed 255px with the plus at a fixed x and the two cards use slightly different
  insets/heights (189 / 227px); here the pill flexes and both cards share one layout with natural height.
- Context: Figma shows the permanent "Household" note as a heading + bullet list; items are plain text here
  (line breaks in a note are kept).
- Patient: battery ring is an SVG (white track + green arc, amber ≤20%); Figma uses a Material progress indicator
  with gaps between track and arc. Mic glyph inside the dark circle, the send arrow in the field, the chevron next to
  each time and the source icons (Lucide) are not in Figma. Day headers and "Load older" are additions.
- Patient: Figma's pill waveform is a placeholder image; waveforms are drawn from `waveform_peaks` (30 bars).
- Routines: Figma's list card is a fixed 374×670 with no group headers; here it has natural height, Morning /
  Afternoon / Evening headers and an "Add routine" label next to the plus. Day letters are 24×30px targets
  (below 44px; the add/edit dialog has 44px day buttons). The M3 switch is rebuilt in CSS (`Switch.jsx`).
- Routines: Figma shows lowercase "lunch" in the chip; the routine title is used as stored.
- Settings: card titles are 12px (Figma 10px) and pill buttons are 32px tall (Figma 24px) for legibility/touch.
  The strict-validation switch is the shared green `Switch` (Figma's is grey). Sliders are single-value range inputs
  (Figma draws a handle at both ends). The voice pill is a native select with Figma's arrow (rotated to point down).
  Name/Email are editable inputs (Figma shows static labels); saved indicator and recording notice are additions.
- (Terminal response page and its source label removed 2026-10-12; see "Terminal home rework".)
- Terminal reply/greeting text has no panel (2026-10-12): measured white-on-gradient contrast 2.13–3.12:1
  (min 2.41 on the greeting line), not-yet-spoken words 1.83–2.53:1; target is 7:1. Details and per-region numbers in
  "Terminal home rework → Remaining diffs vs Figma 1:2".

---

## Terminal home rework (2026-10-12, Figma 1:2)

### Done
- **One screen** at `/terminal`: `/terminal/response` and `/terminal/clock` routes deleted (`pages/Response.jsx`,
  `pages/Clock.jsx` removed; `TODO(clock)` in `App.jsx` + `Home.jsx`). `/terminal/pairing` kept (pairing flow unchanged).
- **One reply path** `presentReply({text, parts, audioEl?, source})` in `App.jsx`, used by typed input (`/api/respond`),
  `response:ready` (plays `audio_url` when present), `broadcast:message`, `routine:trigger` (`audio_script`) and
  `voice:test`. Leaves the pairing screen if it is open. Empty text → i18n `response.noText`.
- **Lifecycle** `client/src/lib/replyLifecycle.js` (framework-free) + `hooks/useReplyLifecycle.js`: idle → speaking →
  holding → idle. Speaking = audio duration (ends on `ended`/`error`, safety timeout) or estimate
  words / 2.5 per s / `playback_speed` + 0.5 s; `playback_speed` now read from `settings:sync`. Holding = `HOLD_MS`
  (8 s, one constant). A new reply cancels the old timers/audio listeners.
- **Reply in the greeting's box** `components/ReplyText.jsx`: 250 ms cross-fade greeting ↔ reply, word highlight
  advanced per frame across the speaking duration. >3 lines → shrink 40 → 32 px, then grow downward; moves up only
  if the text would pass the stage bottom (`lib/replyLayout.js`).
- **Reply styling (follow-up, same day)**: the dark panel behind the reply is gone. Greeting and reply share one text
  style: Inter ExtraBold, 40 px (32 px min for long replies), white, centered, same box (271, 610, 703), no background,
  border or radius, and the same soft shadow `0 2px 12px rgba(0,0,0,0.35)` (`TEXT_SHADOW` in `lib/contrast.js`).
  Words not yet spoken stay white at 80%.
- **Contrast test** (`lib/__tests__/replyDisplay.test.js`): samples the mesh gradient behind the text box every 4 px
  (same `sampleBicubic` as `MeshBackground`, 88% over the white stage) and logs min / median / max for white and for
  80% white. It no longer requires 7:1 (see "Known visual diffs"); it fails only if the minimum drops below the
  measured value (white 2.1, upcoming 1.8), i.e. if the background behind the text gets brighter.
- **Waveform** `components/WaveformBars.jsx`: exact Figma tops/heights, no idle animation; while speaking each bar is
  `scaleY` 0.35–1.0 from the bottom edge, smoothed (attack 60 ms / release 160 ms), rAF; eases back in 400 ms.
  Amplitude source behind `hooks/useAmplitudeSource.js` / `lib/amplitude.js`: AnalyserNode on the audio element
  (MediaElementSource created once per element, cached in a WeakMap) or procedural speech-like noise.
  `prefers-reduced-motion` → slow uniform pulse. Bars are now placed in stage coordinates (the old wrapper shifted
  them 2px up) and the non-Figma 2px baseline line is gone.
- **Screen fixes**: typed dev input is inside the stage at (297, 140), 600 wide, semi-transparent, error below it;
  debug overlay moved to the bottom-left (shows `reply` phase instead of `audio`); letterbox filled with the same mesh
  (cover-scaled) plus the header band continued across; stage backdrop is white under the 88% mesh (was purple);
  mesh canvas has the stage aspect so it fills the stage without cropping.
- Greeting uses the Figma apostrophe ("I’m").

### Verification
- `cd client && npm test` (new, vitest): 2 files, 28 tests (lifecycle timers, replace mid-speech / during hold,
  audio end/error/safety/detach, highlight, estimate, contrast, font fit, box top, procedural levels).
  After the styling follow-up: 2 files, 22 tests (the contrast block is now 2 sampled-region tests instead of 8).
- Styling follow-up, headless Chrome 1194×834 with `/api/respond` stubbed via CDP (no DB rows): computed style of the
  greeting and of a reply are identical (Inter 800 40px, white, centered, same shadow, box 271/610/703, transparent,
  radius 0, nothing else in the box); a 183-char reply renders at 32 px and ends at y=802; no console errors.
  `npx vite build` OK. Server suite not touched.
- Headless Chrome at 1194×834 against the live backend + Vite, throwaway paired tablet, caregiver socket sending
  `broadcast:message` (the portal Patient screen's event, acked `{success:true}`): idle bars static at Figma heights;
  reply shown in the greeting box; bars moving 0.53–0.88 while speaking; back to Figma heights in holding; greeting
  back after 5.3 s + 8 s; second broadcast replaced the first mid-speech; 28-word and 183-char texts → 32 px, panel
  ends above the stage bottom; typed `?dev=1` "Where is Timothy?" → real LLM reply (ID) in the same box;
  `/terminal/response` redirects to `/terminal`; 1600×834 letterbox filled; no console errors.
- Not tested: real audio (`audio_url` / analyser mode), reduced-motion pulse, a real tablet, a broadcast typed in
  the portal UI itself (the socket event was sent directly).

### Remaining diffs vs Figma 1:2 (not fixed)
- **Contrast below 7:1 (measured, no panel by decision)**: white text against the gradient behind the text box is
  2.41 min / 2.61 median / 3.04 max on the greeting line (y 610–658) and 2.13 / 2.63 / 3.12 over the full reply area
  (y 610–818). Not-yet-spoken words (80% white): 2.04 / 2.17 / 2.47 and 1.83 / 2.18 / 2.53. The text-shadow is
  not counted in these numbers. This misses the CLAUDE.md target (terminal contrast ≥7:1).
- Header (pre-existing, shared component): Figma's play triangle (62:119) is 32×31 at x=594 and the chevron (58:2) is
  larger; ours are ~12px icons next to the text. Brand/tagline sit a few px lower than Figma (top 7 / 76).
- Greeting is centered in the 703px box (as specified); Figma's text box is left-aligned (difference ~5px here).
- Mesh: canvas approximation of Figma's WebGPU shader fill; colours close, Figma shows faint blocky artefacts at the top.
- Letterbox: the cover-scaled mesh does not line up exactly with the stage's own mesh, so a faint seam shows at the
  stage edges on wide screens.

### Test data
- **Not cleaned up**: the checks created caregivers 9–12 + patients 9–12 (code-paired, email NULL) with one device
  each and their broadcast interaction/audit rows on the `DATABASE_URL` DB. The delete was blocked by a permission
  rule in this session; delete them manually.

---

## Voice and routines (2026-10-12, one session: A audio → B mic → C scheduler)

### Inspected first (what already existed)
- No `/api/tts`, no voice-gender setting, no scheduler, no `last_fired_on`, **no interaction clip storage** (the
  portal's waveform rows are mocked only), so recorded speech is discarded right after transcription (FR-4.2.5).
- Terminal Start gate existed but was persisted in localStorage (`terminal_started`) and unlocked nothing.
  `hooks/useAudioMode.js` (Web Speech) was unused. `GET /api/settings/voices` returned the raw ElevenLabs voice IDs.

### Part A: audio out (DONE)
- **Server**
  - `src/services/voiceService.js`: `resolveVoiceId(language, gender)` = exact `ELEVENLABS_VOICE_ID_{ID|EN}_{FEMALE|MALE}`
    → legacy `ELEVENLABS_VOICE_ID_{ID|EN}` → same language, other gender (never another language; unknown gender →
    female, unknown language → en). `listVoiceOptions()` (no IDs). `synthesizeStream()` calls ElevenLabs
    `/v1/text-to-speech/{voice}/stream` (mp3), model `ELEVENLABS_MODEL_ID` (default `eleven_multilingual_v2`),
    `voice_settings.speed` = playback_speed; key only in the `xi-api-key` header; secrets redacted from errors.
  - `GET /api/tts?text=` (`routes/tts.js`, `controllers/ttsController.js`): device token (`x-device-token`, or
    `?token=` because an `<audio>` src cannot send headers) or caregiver JWT + `patientId` (ownership checked).
    ≤300 chars (zod), patient's language + `voice_gender` + playback_speed, streamed `audio/mpeg`, `no-store`,
    nothing stored, upstream aborted if the client leaves. 30 requests/min per device (or caregiver) → 429.
    Missing key/voice or ElevenLabs failure → `503 {error:'Voice unavailable', code}` (`tts_not_configured`,
    `voice_not_configured`, `tts_upstream`, `tts_timeout`).
  - `GET /api/voices` (caregiver JWT) → `[{language, gender, available}]`. The old `/api/settings/voices` path now
    returns the same safe list.
  - Migration `005_voice_gender.sql`: `patient_settings.voice_gender` ('female'|'male', default 'female'). Ran on the
    `DATABASE_URL` DB. `PUT /api/settings` accepts it (audit + `settings:sync`). The legacy `voice_id` column is no
    longer read or written, so no voice ID reaches a client; `voice:test` carries `voice_gender` instead.
  - `config/env.js` declares `ELEVENLABS_MODEL_ID`, the four gendered voice IDs, the legacy pair and `GEMINI_STT_MODEL`
    (note: nothing in the server requires `env.js`; services read `process.env`).
- **Terminal**
  - `components/StartGate.jsx`: full-screen "Tap to start" on every load (not persisted), styled like the home screen
    (stage, mesh, header, still bars, prompt in the greeting's box and style). The tap calls `unlockAudio()` synchronously.
  - `lib/speaker.js`: one shared `<audio>` (crossOrigin anonymous; MediaElementSource → analyser wired in the
    unlock). `speak()` = stream `/api/tts?…&token=` → on element error fetch the same URL with the header → blob
    (Safari range quirk; also yields the server's reason) → `speechSynthesis` in id-ID / en-US. Newer speech cancels
    older. Volume 60–70 dB → element volume 0.5–1.0.
  - `App.jsx` `say()` is the single path for typed replies, `response:ready`, broadcasts, `voice:test`, routines:
    speak, then `presentReply` with the playing audio element (waveform = AnalyserNode, highlight = audio clock) or
    with the speech handle (simulated waveform). Terminal language now follows `context:sync` (item 20 for speech);
    `volume_db` from `settings:sync`. `lib/wav.js`: 16-bit WAV encoder (also builds the silent unlock clip).
  - `lib/replyLifecycle.js`: `speech` handle: speaking ends when both the estimate has elapsed and the speech ended
    (safety cap); highlight follows `audio.currentTime` / duration, or the estimate while a stream has no duration yet.
  - Dev overlay (`?dev=1`): `voice elevenlabs | browser speech` + the fallback reason in red.
- **Portal Settings**: voice dropdown = Female / Male for the patient's language from `/api/voices` (i18n
  `portal.settings.audio.gender.*`; "(not set up)" + disabled when that gender has no voice); saves `voice_gender`.
  Test Voice: tablet online → `voice:test`; offline/failed → `/api/tts` with the JWT played on the phone, else
  browser speech.
- **Tests**: `server/src/__tests__/voice-a.test.js` (resolveVoiceId fallbacks, `/api/voices` has no IDs, `/api/tts`
  validation, auth, ownership, 503 without key/voice, rate limit, ElevenLabs request shape, redaction). Client
  lifecycle tests +4 (speech fallback, stream highlight).

### Part A verification
- `cd server && npm test` → 7 suites, 195 passed, 12 skipped. `cd client && npm test` → 26 passed. `vite build` OK.
- Live (backend + Vite, the existing throwaway tablet of patient 12; only its settings/audit rows changed):
  `/api/tts` 200 `audio/mpeg`; caregiver JWT own patient 200, other patient 403, no patientId 400; `/api/voices`
  body has no IDs. Headless Chrome 1194×834: gate shown, nothing in localStorage, tap unlocks; `voice:test` from a
  caregiver socket → ElevenLabs audio played on the shared element, overlay `voice elevenlabs`, bars moving
  1.4 s → 5.2 s after the emit (≈ audio length), then holding. `/api/tts` forced to 503 → `speechSynthesis` `id-ID`,
  simulated bars, overlay `tts: audio element error (media 4); tts 503 tts_not_configured`. Portal 402×874: options
  Female / Male, select → PUT `voice_gender` 200, Test Voice → "Sent to the tablet". No console errors.
- **TTS latency**, time to first audio byte from ElevenLabs (this machine, 3 runs each, ~15-word sentence):

  | model | id | en |
  |---|---|---|
  | `eleven_multilingual_v2` (default per brief) | 1113–1282 ms | 939–1654 ms |
  | `eleven_flash_v2_5` | 139–144 ms | 133–147 ms |
  | `eleven_turbo_v2_5` | 215–233 ms | 188–200 ms |

  Through `/api/tts` with the default model: first byte 1.16–1.18 s (3.8 s on a cold first call). **Misses the
  500 ms target (FR-4.4.1) with the default model**; `ELEVENLABS_MODEL_ID=eleven_flash_v2_5` would meet it. Not
  changed (needs a decision).

### Needs manual testing on the tablet (Part A)
- Real speaker output and volume; iPad Safari playing the streamed `/api/tts` (else the blob retry should catch it).
- Analyser-driven bars with real audio (headless proved the audio path and movement, not the spectrum).
- `speechSynthesis` voices on the tablet in id-ID / en-US when ElevenLabs is down.
- Portal Test Voice with the tablet offline (local `/api/tts` playback was checked only at the API level).

### Part B: microphone (DONE)
- **Capture** (`lib/voiceInput.js`): `requestMic()` runs inside the Start tap with `{echoCancellation, noiseSuppression,
  channelCount: 1}`. Silero VAD v5 via `@ricky0123/vad-web` 0.0.31 (`MicVAD`, shared AudioContext), segments < 0.4 s
  ignored (`minSpeechMs` + own check). Pausing capture **stops the mic tracks**; resuming calls getUserMedia again.
  Start/pause are serialized. VAD assets (worklet, `silero_vad_v5.onnx`, onnxruntime-web wasm/mjs) are self-hosted
  under `/vad/` by `vite-plugin-static-copy` (`vite.config.js`); the ORT wasm is 14 MB (first load only, then cached).
- **State machine** `lib/micMachine.js` (framework-free, `COOLDOWN_MS` 3000): off / listening / processing / speaking /
  cooldown; only listening captures; speech ending in any other state is dropped. Every `say()` (voice, typed,
  broadcast, routine, voice test) calls `speakStart()` before TTS loads; the reply lifecycle leaving `speaking` (and no
  other say pending) calls `speakEnd()` → 3.0 s cooldown → listening. Wired in `hooks/useVoiceLoop.js`.
- **Upload**: each segment → 16 kHz mono 16-bit WAV (`lib/wav.js`) → `POST /api/respond` multipart
  `{audio, source:'voice'}` (`terminalFetch` lets FormData set its boundary). `meta.no_speech` → back to listening.
- **Server STT** `server/src/services/sttService.js`: Gemini `generateContent` with the WAV inline, JSON schema
  `{transcript}`, temperature 0, prompt asks for the exact words in the patient's language and an empty transcript
  for silence/noise. Model `GEMINI_STT_MODEL` else `GEMINI_MODEL` (checked: `gemini-3.5-flash-lite` accepts audio, so
  no switch to a flash model was needed; `gemini-3.5-flash` invented a sentence from silence; `gemini-3.1-flash-lite`
  timed out). `isJunkTranscript()` drops empty, punctuation-only, noise tags (`[noise]`, `(silence)`, …) and
  filler-only ("hmm", "uh um"). Timeout `STT_TIMEOUT_MS` (default 6000). Key in the `x-goog-api-key` header only.
- **`routes/respond.js`**: multer memory storage (2 MB, 1 file); junk/empty → `{transcript:'', text:null, parts:[],
  meta:{no_speech, stt_ms}}`, no chain, nothing logged; STT error → 502 `{error, code}`, no reply; otherwise the
  unchanged chain + fallbacks on the transcript, logged `source: voice`, `{transcript, text, parts, meta:{…, stt_ms}}`.
  The buffer is dropped right after transcription (no clip storage exists; FR-4.2.5). Chain/validator/prompts untouched.
- **Waveform**: still while idle/listening/processing; moves only in the reply's `speaking` phase (real audio analyser).
- **Dev overlay** (`?dev=1`, width capped): mic state, VAD probability, last transcript, per-stage ms; console
  `[voice] timings ms`. Mic denied / missing → mic `off`, typed input opens automatically, red `mic: <reason>`.
- `hooks/useAudioMode.js` (unused Web Speech hook) deleted.
- **Tests**: `client/src/lib/__tests__/micMachine.test.js` (9: full loop, 3.0 s cooldown, drops during
  processing/speaking/cooldown, broadcast while listening, cooldown restart, no-mic). `server/src/__tests__/voice-b.test.js`
  (26, real Express + multipart: transcript-only chain input, junk → no reply/no log, STT 502, 413/400, typed JSON,
  `isJunkTranscript`, Gemini request shape/key redaction).

### Part B verification
- `cd server && npm test` → 8 suites, 221 passed, 12 skipped. `cd client && npm test` → 3 files, 35 passed. Build OK.
- Headless Chrome with a fake microphone playing a looped WAV (ElevenLabs-generated "Timothy di mana? Aku mau
  pulang.", 3 s silence before, 26 s after), live backend + Gemini + ElevenLabs, sampled every 100 ms for 50 s:
  listening (1 live track) → processing (0 tracks) → speaking (TTS loading, then audio; bars moving) → cooldown at
  31.1 s → listening at 34.2 s (3.1 s) → the next loop of the clip heard → processing → speaking. **0 samples with a
  live mic track outside listening.** Heard "Timoti di mana? Aku mau pulang."; reply spoken in the greeting box.
  Mic denied → `off`, typed input shown, overlay "mic: microphone permission denied". No console errors.
- The running dev server on :5173 was started before this session and did not pick up `vite.config.js`; the check
  ran on a second Vite (:5174). Restart `npm run dev` to get the `/vad/` assets.

### Measured latency (Part B, this machine → Gemini / ElevenLabs over the internet)

| stage | target | measured |
|---|---|---|
| VAD end → transcript (upload + server STT) | ≤ 800 ms (FR-4.2.2) | 2157 ms in the warm browser run (server STT 1775 ms); STT alone 1.4–2.5 s in 12 direct calls. **Misses** |
| transcript → reply (LLM chain) | ≤ ~2 s | 789 ms warm (the LLM budget is `LLM_TIMEOUT_MS`). Meets |
| reply → audio start (TTS) | ≤ 500 ms (FR-4.4.1) | 1646 ms in the browser with `eleven_multilingual_v2` (first byte ~1.1 s + buffering). **Misses**; `eleven_flash_v2_5` first byte ~140 ms |
| VAD end → audio start | | 4591 ms warm; the first (cold) cycle took ~5.4 s to the reply alone |

The VAD end itself comes 1.4 s after the last word (`redemptionMs` default, kept so slow speakers aren't cut off).
STT latency is model/network bound: plain-text vs JSON output and "minimal thinking" made no difference.

### Needs manual testing on the tablet (Part B)
- Real mic on the tablet (permission prompt over HTTPS, echo cancellation with the speaker, room noise, elderly speech).
- iPad Safari: getUserMedia after the tap, AudioWorklet VAD, re-acquiring the mic after each reply, audio output
  volume while the mic is open.
- That nothing is captured while the reply plays (verified headless via track state, not acoustically).
- First load time of the 14 MB VAD wasm on the tablet's network.

### Part C: routine scheduler (DONE)
- **Server** `src/services/routineScheduler.js`, started with the server (`src/index.js`, not under `NODE_ENV=test`),
  every 30 s. Clock = `Intl.DateTimeFormat` with `timeZone: 'Asia/Jakarta'` (date, HH:MM, weekday), never the
  server's local time. Pure `classifyRoutine()`: active + today's weekday (`days` empty/NULL = every day) + time
  reached today + `last_fired_on` ≠ today →
  - ≤ 10 min late and a terminal socket (`device:*` room) is in `patient:{id}` → `routine:trigger
    {id, title, audio_script, category}` to the room, interaction logged (`source: routine`, transcript = title,
    ai_response = `{text: script, parts}`), `interaction:new` to the portal, marked fired;
  - ≤ 10 min late, terminal offline → waits; `deliverPending()` runs on terminal (re)connect (`socket/index.js`);
  - > 10 min late → skipped, logged as missed (`ai_response {missed: true, reason: 'terminal_offline', script}`) + `interaction:new`;
  - due before the scheduler process started (server down / first deploy) → marked handled, no missed log.
  Marking is an atomic `UPDATE … WHERE last_fired_on IS DISTINCT FROM today RETURNING`, so a routine fires at most
  once per Jakarta day. Script = `audio_script`, else `display_text`, else title.
- Migration `006_routine_scheduler.sql`: `routines.last_fired_on DATE` (ran on the `DATABASE_URL` DB).
- **Times**: `trigger_time` is Asia/Jakarta wall-clock (TIME, no zone), validated `HH:MM` 24 h (zod, field error).
  Creating a routine, or changing its time/days, after its time today sets `last_fired_on` = today, so it is neither
  fired late nor logged missed for today; a new time still ahead today fires today (`routinesController.js`).
- **Terminal**: `routine:trigger` goes through `lib/speechQueue.js`: spoken at once when free, otherwise queued (in
  order, once per routine id) while a reply is speaking, a reply's TTS is loading, or the mic is processing; pumped
  when the phase / mic state changes. Spoken via the Part A path (`say` → `/api/tts` → greeting box), so the mic is
  stopped while it plays (Part B).
- **Portal**: Home Schedule and the Routines "next" chip use the Asia/Jakarta clock (`client/src/lib/jakartaTime.js`)
  instead of the phone's timezone. Interaction log: routine rows show "Routine: <title>" and the script, or
  "Missed: the tablet was offline. Not spoken:" + script.
- **Tests**: `server/src/__tests__/routines-c.test.js` (30: Jakarta clock incl. midnight/month/year crossing and
  `TZ` independence, exact minute, 10-min grace → missed, weekdays incl. the Jakarta weekday at 00:05 = UTC Sunday,
  once per day with string/Date `last_fired_on`, inactive/bad time, create/re-time rule, runTick online / offline wait
  → reconnect / missed / stale / double claim, script fallback, time validation). Client
  `lib/__tests__/speechQueue.test.js` (6: immediate, wait for speaking, order, processing, dedupe, pump while busy).

### Part C verification
- `cd server && npm test` → 9 suites, 251 passed, 12 skipped. `cd client && npm test` → 4 files, 41 passed. Build OK.
- Live on patient 12 (headless terminal on :5174 + caregiver socket, routines created/deleted via the API):
  - Queue: routine due 23:01 WIB fired at the server 7.5 s into the minute while `voice:test` replies kept the
    terminal speaking for 40 s; the terminal spoke it 1.3 s after the last reply finished, in the greeting box.
  - Offline: terminal closed when a routine came due at 23:03; ≥ 45 s later nothing had been delivered; on reconnect
    it was delivered at once (`interaction:new` before the page finished loading) and spoken.
  - Missed: routine due 23:06 WIB with the terminal closed; at ~23:17 (first tick > 10 min late) the portal socket got
    `interaction:new` with `ai_response.missed`; reopening the terminal afterwards did not speak it.
  - Portal 402×874: Home Schedule + Routines chip show the routine at its Jakarta time; log rows render; no errors.
- Delivery delay = scheduler tick alignment, 0–30 s after the minute starts (+ TTS start).

### Test data / side effects (Part C)
- **The first scheduler tick (before the "stale" rule existed) logged two spurious "missed" routine rows** for
  routines whose time had passed before the scheduler existed: `interaction_logs` id 50 (patient 7, "Lunch" 12:00)
  and id 51 (patient 13, "Eat medicine" 22:15). Their `routines.last_fired_on` is today, which is harmless (they fire
  again tomorrow). Delete rows 50 and 51 if those patients are real; not deleted here.
- Patient 12 (throwaway, see "Terminal home rework → Test data") got voice/routine interaction rows, a settings row
  (`voice_gender`) and audit rows from these checks. Its test routines were deleted through the API.

### Needs manual testing on the tablet (Part C)
- A routine at a real time with the tablet on: spoken through the speaker, mic muted while it plays.
- Tablet asleep / offline at the routine time, back within 10 minutes (delivered) and after 10 minutes (missed in the
  portal log, not spoken).
- A routine arriving while the patient is talking (should wait for the reply, then play).

---

## Safety, replies, layout session (2026-10-21): A content safety → B replies → C type + responsive

### Part A: content safety (DONE, committed locally)
- `server/src/services/contentSafety.js`: `checkPatientFacingText(text, {language, kind})` → `{ok, category, reason}`.
  Tier 1 rules (ID + EN, normalised: accents, punctuation, leetspeak, stretched letters; negation window for instruction
  rules so "Jangan sentuh kompor ya" passes). Tier 2 Gemini classifier (2.5 s, `GEMINI_SAFETY_MODEL` else `GEMINI_MODEL`),
  Tier 1 decides on failure with a `[safety]` warning. `checkTier1` is the sync rule check.
- `server/src/services/safetyGate.js`: check + audit `content.blocked` `{kind, category}` (never the text).
- Enforced before save/emit: POST/PUT `/api/context-items` (422), routines create/update (title, audio_script,
  display_text; 422), `broadcast:message` (ack `unsafe_content`; 10/min per caregiver → `rate_limited`), `voice:test`.
- Re-check of stored rows (Tier 1): `contextService.recheckItems` (portal list + LLM/terminal snapshot, blocked rows
  left out), `routineScheduler.recheckRoutine` (list + every tick; blocked routines never fire nor log "missed").
  Migration `007_content_safety.sql` adds `blocked_category` to `context_items` and `routines` (applied to the dev DB).
- Output side: every AI reply is Tier-1 checked in `llm/chain.js` (fails → fallback); prompts wrap the patient words and
  notes in `<<<PATIENT …>>>` / `<<<NOTES …>>>` as data and forbid deaths/threats/illness/hospital.
- Fixed on the way: fallback replies now carry `text` + `parts` (old known bugs 12 and 22).
- Portal: inline refusal message (i18n `portal.safety.*`) in Context (add + new inline edit), RoutineForm (form now waits for
  the server), Patient broadcast; red "Blocked for safety" label on context items and routine rows. `emitWithAck` keeps the
  ack `code`. Routine script max lowered 1000 → 300 (the content-safety max; flagged).
- Tests: `server/src/__tests__/content-safety.test.js` (Tier-1-only lists, mocked classifier: block, low confidence,
  error, invalid shape, 2.5 s timeout; controllers, broadcast, rate limit, re-check, scheduler, reply fallback).
  **A6 result (Tier 1 only): MUST-BLOCK 8/8 blocked, MUST-ALLOW 7/7 allowed.** With a mocked agreeing classifier: same.
- Live Tier 2 check (2026-10-21): every classifier call timed out at 2.5 s, so Tier 1 decided (as designed). Raw calls
  to the Gemini API from this machine took 20–64 s even for "Say OK." (0 thinking tokens), with intermittent connect
  failures (TCP connect up to 7.9 s); `thinkingBudget: 0` is rejected (400) by `gemini-3.5-flash-lite` over REST
  (LangChain 0.1.12 drops it, so no error there). Re-run when the network is normal.

## Session summary: voice + routines (2026-10-12)
- **Done**: A (ElevenLabs `/api/tts`, voices by gender, Tap-to-start, shared audio element + analyser, browser speech
  fallback, portal voice + Test Voice), B (Silero VAD mic, server STT with Gemini audio, mic state machine with 3.0 s
  cooldown, dev overlay timings), C (Asia/Jakarta routine scheduler with once-per-day, 10-min offline grace, missed
  log, terminal queue, portal Jakarta clock). Commits on local branch `phase-5-voice` (not pushed).
- **Measured latencies** (this machine, internet APIs): STT 1.4–2.5 s (target 800 ms, **missed**), LLM reply
  0.8 s warm (target ~2 s, met), TTS first byte 0.94–1.65 s with `eleven_multilingual_v2` (target 500 ms, **missed**;
  `eleven_flash_v2_5` 133–147 ms), browser reply → audio start 1.65 s, VAD end → audio start 4.6 s warm. Routine
  delivery 0–30 s after its minute.
- **Needs manual testing on the tablet**: see the three "Needs manual testing" lists above (speaker/mic hardware,
  iPad Safari audio + mic + VAD, echo, real routines on/offline).
- **Decisions needed**: TTS model (flash meets 500 ms), STT latency vs 800 ms, the 7:1 contrast and clock-mode
  targets (items 19 and the "Known visual diffs"), spurious missed rows 50/51.

---

## Known bugs / open items
1. **Run `npm run db:seed`** and smoke-test the 3b endpoints (migrate 001–004 has now run against `DATABASE_URL`). (CLAUDE.md says
   `db:migrate`; the script is named `migrate`.)
2. **Anxiety fallback violates guardrails**: `src/llm/fallbacks.js` anxiety `redirect` contains `?` (EN + ID) and the ID
   `validate` contains stray Chinese characters. The guardrail test only checks the generic theme
   (`getFallback('test', …)`), so it passes. Not changed in 3b (fallbacks were out of scope). Needs a decision.
3. Fallback scripts (up to ~21 words) can exceed a reduced per-patient cap (e.g. max_speech_seconds 8 → 20 words).
4. Remaining Figma routines (frame 60:30) not seeded: `TODO(wire)` in `src/db/seed.js`.
5. "Today" uses Postgres `CURRENT_DATE` (server timezone). On a UTC host, daily items roll over at 07:00 WIB.
6. ~~Broadcast text is not checked~~ fixed 2026-10-21: content safety (Part A) checks it before it is emitted.
7. `routinesController.js` still has no try/catch around DB calls (pre-existing).
8. Client still on the old contract: `/api/respond` sent with `Authorization: Bearer`
   instead of `x-device-token`; calls non-existent `/api/patients/me`; `device:status` without battery is rejected;
   expects the old context shape (visitor_name/arrival_time/passive_cue) and does not handle `settings:sync`,
   `broadcast:message`, `voice:test`.
9. ~~Pairing requires a caregiver JWT~~ fixed 2026-10-10 (public code-only pairing, see below). Open: `register`
   still resets `devices.patient_id` to NULL, so re-entering Caregiver mode on a paired tablet unpairs it and the
   next pair creates a new caregiver + patient. The pair service already reuses a device's existing patient if
   register stops resetting it; decide which behaviour the demo wants.
10. ~~No routine scheduler~~ done 2026-10-12 (Part C). Open: a routine due in the last minutes before midnight
    whose terminal reconnects after midnight is never delivered or logged (the new Jakarta day starts clean).
21. `devices.is_online` is never set false on disconnect, so the portal shows a closed tablet as Online (seen during
    Part A/C checks). The scheduler does not use this flag (it checks live sockets).
22. ~~Fallback replies still have no `text`~~ fixed 2026-10-21. Was: (item 12), so a voice utterance that falls back is spoken as the client's
    "I am here with you." / "Saya di sini bersama Anda.".
19. CLAUDE.md target "terminal returns to clock mode 60 s after audio ends" no longer holds: clock mode is removed and
    replies return to the greeting 8 s after speaking (per the 2026-10-12 brief). Needs a decision / CLAUDE.md update.
20. Terminal language stays `en` after pairing an `id` patient (`/api/patients/me` doesn't exist; part of item 8).
11. **Every LLM call fails**: Gemini returns 404 "models/gemini-2.5-flash-lite is no longer available to new users"
    (suggests `gemini-3.5-flash-lite`). The model is pinned in CLAUDE.md; needs a decision. `chain.js` catch hides the error.
12. ~~Fallback replies have no text~~ fixed 2026-10-21 (`fallbackReply` in `llm/chain.js`). Was: `getFallback` returns `{validate, reassure, redirect, _theme}` but `/api/respond`
    sends `aiResponse.text`/`parts`, so every fallback is a 200 with an empty reply (also `llm:try` prints `text: undefined`).
13. An unpaired device's token gets 401 "Invalid device token" on `/api/respond` (the only device in the DB right now
    is unpaired). Pair the tablet, or run `npm run db:seed` and use the printed token.
14. **LLM latency vs FR-4.3.2**: `gemini-3.5-flash-lite` takes ~1.1–1.7 s from this machine, so the 1.2 s budget
    falls back on most calls. Needs a decision (raise `LLM_TIMEOUT_MS`, stream, or a different model). Not changed.
15. Retry runs even on non-retryable errors (404/400), burning the rest of the budget.
16. ~~With empty context the model invents facts~~ fixed 2026-10-11 in the prompts (see "Clinical fix"). The
    validator still can't catch an invented fact; only the live suite (`LIVE_LLM=1`) checks it.
17. Live runs saw `Aborted` after ~1-2 s with `LLM_TIMEOUT_MS=4000` in `.env` (EN, no context). Not investigated.
18. The ID model often adds a "ya" tag ("Kamu sedang mencari Timothy ya."). There's no `?`, so it passes the
    validator, but it reads like a soft question. Clinical call.

## Client state
- `npx vite build` succeeds; dev server starts.
- Routes: `/terminal`, `/terminal/pairing`, `*` → `/terminal`. Start gate first. Replies render on `/terminal` (no response page).
- Typed input toggles with ` (Esc closes), debug overlay with ~ (Shift+`); keys ignored while a field is focused.
  `?dev=1` shows both permanently. Old Ctrl+Shift+T/D dropped (Chrome intercepts them). Overlay shows route, socket,
  reply phase, language, token/patient presence, context sync; bottom-left since 2026-10-12. Shortcuts in `docs/demo-script.md`.
- Portal routes: `/portal/pair`, `/portal`, `/portal/patient`, `/portal/routines`, `/portal/context`, `/portal/settings`
  (`client/src/portal/PortalApp.jsx`).

---

## NEXT
- IN PROGRESS (2026-10-21): Part B (situation-specific replies, fallback ladder) then Part C (type scale + responsive).
- Re-run the live Tier 2 safety check once the Gemini API is reachable at normal speed (see Part A).
- Tablet test of Parts A–C (lists under "Voice and routines"); restart `npm run dev` first so `/vad/` assets are served.
- Delete spurious routine "missed" rows 50 and 51 if patients 7 / 13 are real (see Part C side effects).
- Decide on STT latency (Gemini audio 1.4–2.5 s vs the 800 ms target): accept, or move to a streaming STT.
- Decide the TTS model (`ELEVENLABS_MODEL_ID=eleven_flash_v2_5` meets the 500 ms first-byte target; the default misses it).
0. Delete the 2026-10-12 test rows (patients/caregivers 9–12, see "Terminal home rework → Test data").
1. Decide model (item 11: set `GEMINI_MODEL=gemini-3.5-flash-lite`?) and timeout (item 14), fix the fallback shape
   (item 12), then re-test typed input.
2. Run seed against the `DATABASE_URL` DB; smoke-test the 3b endpoints.
3. Decide on the anxiety fallback (item 2).
4. Update the terminal client to the new contract (item 8), then commit Phase 3 on `phase-3-terminal`.
5. Phase 4: Caregiver Portal screens are built (see "Portal C2"): run the manual device checks, then verify Phase 4
   and tick it.

## Environment variables
Names only (values live in `server/.env`, never here): `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_STT_MODEL`
(optional), `STT_TIMEOUT_MS` (optional, default 6000), `LLM_TIMEOUT_MS`, `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID` (optional), `ELEVENLABS_VOICE_ID_ID_FEMALE`,
`ELEVENLABS_VOICE_ID_ID_MALE`, `ELEVENLABS_VOICE_ID_EN_FEMALE`, `ELEVENLABS_VOICE_ID_EN_MALE` (legacy
`ELEVENLABS_VOICE_ID_ID` / `_EN` still read as fallback), `JWT_SECRET`, `DATABASE_URL`, `CLIENT_ORIGIN`, `API_ORIGIN`,
`PORT`, `TZ`.
