# Intacta - AI Collaboration & Code Guidelines

## What this is
Ambient AI dementia-care assistant (hackathon project, 7-day sprint, solo dev builds frontend + backend; teammates handle the paper). Two clients + one backend:
- **Patient Terminal** (tablet, touchless): listens → STT → LLM → TTS + high-contrast display
- **Caregiver Portal** (mobile web, accent #0D6C8C): pairing, context, routines, live log, settings
- **Backend**: Express + Socket.IO + PostgreSQL (Kysely) + LangChain/Gemini

## Build Status
- [x] Phase 1: DB + JWT REST + Socket.IO sync (<1s)
- [ ] Phase 0: Phase 1 audit + deploy skeleton + .id domain
- [ ] Phase 2: LLM validation engine
- [ ] Phase 3: Patient Terminal + code pairing
- [ ] Phase 4: Caregiver Portal core (pair, Context, live Patient)
- [ ] Phase 5: Voice loop
- [ ] Phase 6: Routines, Settings, broadcast, EN/ID
- [ ] Phase 7: Resilience, deploy on .id, demo seed
Tick a phase only after its verification passes. If a day slips, cut Settings polish and routine CRUD before touching the core loop (pair → context → speak → respond → live log).

## Project Stack
- **Frontend:** React 18 (Vite), Tailwind CSS, Lucide Icons, socket.io-client, i18n via JSON dictionaries
- **Backend:** Node 20+, Express, Socket.IO, JWT, PostgreSQL via **Kysely only** (no Prisma)
- **AI:** LangChain (`@langchain/core`, `@langchain/google-genai`), `gemini-2.5-flash-lite` with thinking disabled
- **Voice:** Silero VAD / Web Speech API in; ElevenLabs (server-side, streamed) with browser SpeechSynthesis fallback out

## Repo Structure
/client            React app (routes: / start menu, /portal/*, /terminal)
/server/src        routes, controllers, services, sockets, db, llm, middleware
/server/migrations
/docs              SRS + context file + demo-script.md
(Keep this section accurate if the real structure differs.)

## Requirements Conventions
- Requirements follow IEEE 830 ("shall"). Reference FR IDs (e.g. FR-4.3.4) in commit messages and tests.
- Do not silently change a numeric target; flag it and ask.

## Clinical Guardrails (NON-NEGOTIABLE)
ALL patient-facing LLM output:
1. Validate Emotion → 2. Reassure Fact (caregiver context) → 3. Redirect Action
- Max 25 words or 2 short sentences. Language follows `patients.language` (id | en). Warm, simple words.
- NEVER: questions, memory tests, corrections, reality-orientation confrontation, or denying the patient's reality.
- Validate = name the feeling/need the patient expressed, in their words (never generic). Reassure = ONE true thing from the notes,
  today's routines/times or the time of day, else a presence statement phrased around their topic; never invent people's whereabouts,
  times, events, names, or the patient's title/gender. Redirect = a small calming action matched to the situation (hunger/thirst →
  drink/snack ONLY then; fear → slow breathing / something familiar / staying; missing someone → talk about them / a song; pain → tell
  the caregiver; restless → window / gentle walk). Food or drink only if the patient mentions hunger/thirst or a meal routine is ≤60 min away.
- Prompts (`server/src/llm/prompts.js`) describe behaviour abstractly: NO example sentences the model could copy (no "tea"). Inputs: the
  patient's words, daily + permanent notes, today's upcoming routines (title + time), Asia/Jakarta time of day, the last ≤3 exchanges
  within 10 min ("do not reuse their openings or redirects"), and a server-computed "food may be offered" flag. Temperature 0.7.
- LLM returns structured JSON {validate, reassure, redirect}. The validator (`llm/validator.js`) rejects: any `?`; quizzing/correcting
  phrase patterns (whole-word/phrase, never substrings; a sentence opening with "Ingat,"/"Remember,"); >25 words; empty parts;
  non-Latin script. The chain also rejects: over the patient cap; food/drink in the redirect when not allowed; a different part of
  the day than the one the patient named (`time_contradiction`, a correction). Replies are NOT run through the safety classifier (latency): see Content Safety.
- Banned patterns (examples): id: kamu lupa, sudah kubilang/dibilang, tadi kan, apa kamu ingat, ingat tidak, bukan begitu, kamu salah,
  sebenarnya. en: you forgot, I told you, as I said, do you remember, that's wrong, you're wrong, actually. A validating phrase like
  "tidak salah kok merasa begitu" passes.
- Reply ladder (`llm/chain.js`): (1) full prompt, `LLM_TIMEOUT_MS` (default 2500); (2) ONE retry with the short prompt + the rejection
  reason, 2 s (skipped for 400/401/403/404); (3) static fallback from `llm/fallbacks.js`: 15 situation categories × 4 variants of each
  part × 2 languages, chosen by keyword intent (generic last), random, never reusing a piece from the last 3 replies, within the word
  cap; presence statements only; food only in hungry/thirsty. Fallbacks carry `_fallback: true`, `_reason`
  (timeout | api_error:<status> | validation:<rule> | empty) and are logged with latency.
  NOTE (2026-10-21, decision pending): FR-4.3.2 says ≤1.2 s or fallback; the measured model latency does not fit that, so the
  default first-attempt budget is now 2500 ms + a 2 s retry. Confirm or restore.
- Missing context params → generic comforting phrase, never an error (FR-4.3.5).
- Any change to prompts or the validator requires the guardrail suite to pass (`npm test`); live checks: `RUN_LIVE_LLM_TESTS=1 npm test`.

## Content Safety (NON-NEGOTIABLE): text that reaches the patient
- One module: `server/src/services/contentSafety.js` → `checkPatientFacingText(text, {language, kind})` →
  `{ok, category, reason, sensitive, score}`; kind = context | broadcast | routine | voice_test | reply.
- NO word lists. The ONLY decision-maker is a Gemini classifier judging MEANING (any language, slang, misspelling, implication)
  against a rubric with 10-12 few-shot examples (principles, never a list to match). Before the call only technical hygiene:
  NFKC, control/invisible characters stripped, whitespace collapsed, trim, max 300 chars. Temperature 0, structured JSON
  `{decision, category, addressed_to_patient, patient_distress_0_to_10, spoken_aloud_ok, reason_short}`, REST call from the server.
- Model: `GEMINI_SAFETY_MODEL`, default `gemini-3.6-flash` (chosen 2026-10-23 from the key's model list: the strongest non-lite
  flash that answers; 3.7/3.8-flash were overloaded or never answered, 2.5-flash is 404; never the lite reply model).
  Lowest thinking level the model accepts (`minimal` for 3.0-3.6, `low` for 3.7+).
- Categories: threat_or_harm, death_or_harm_prediction, fear_inducing, abandonment_or_shaming, abuse_or_insult, sexual,
  harmful_instruction, sensitive_fact, other, none.
- Block when decision=block OR distress ≥ 4. Spoken kinds (broadcast, routine, voice_test, reply) also block when
  spoken_aloud_ok=false or category=sensitive_fact. kind=context + sensitive_fact (not addressed to the patient) is SAVED with
  `sensitive=true`: never sent to the terminal, given to the LLM as a PRIVATE note it must never mention or hint at.
- Bump `SAFETY_VERSION` whenever the rubric, threshold or model changes (stored rows are then re-screened).

## Code Conventions
- Controllers atomic and thin; logic lives in /services.
- Explicit try/catch + typed error responses on every DB transaction and LLM call. Never swallow errors.
- Validate input at the boundary (zod). Invalid time → 400 with a field-level error (FR-4.1.3).
- Every caregiver mutation writes an audit log (caregiver_id + ISO-8601 timestamp).
- Secrets only in .env (GEMINI_API_KEY, ELEVENLABS_API_KEY, JWT_SECRET, DATABASE_URL, CLIENT_ORIGIN, API_ORIGIN). Gemini and ElevenLabs are called from the server only, never from the browser.
- Terminal localStorage is limited to: device_token and the 24h context cache (plus the start menu's `intacta_mode` {mode}).

## Pairing Flow (code-based, replaces QR)
1. Terminal header "▶ Enable / caregiver connection" (id: "Aktifkan / koneksi caregiver") calls `POST /api/devices/register` →
   `{device_id, device_token, code, expires_at}` when there is no valid code. Code is 6 chars, TTL 10 min, single use; "Get a new code" regenerates.
   It and "Authentication code" open/close the SAME "Connect a caregiver" popup (`components/ConnectCard.jsx`): code, "On your phone, open
   {window.location.origin}/portal and enter this code", a QR code for `{origin}/portal/pair?code=XXXXXX`, expiry countdown, regenerate.
   The terminal never switches to a caregiver view (never call it "Caregiver mode"). The pair screen pre-fills `?code=` (never auto-submits)
   and clears it from the URL (`portal/pairCode.js`).
2. Caregiver enters the code on the phone → `POST /api/devices/pair {code}`: PUBLIC (no login), rate-limited 5/min/IP.
   No Authorization header → a new caregiver (email/password NULL) + patient are created (or the device's existing patient is kept).
   With a caregiver JWT ("Pair New Tablet") → the device links to that caregiver's patient. A bad JWT → 401.
   Returns `{success, token, patient_id, language, device_name}`; token = caregiver JWT {caregiverId, patientId}. Audited `device.pair`.
   Errors `{error, code}`: 400 `code_required`/`invalid_code`, 409 `code_used`, 410 `code_expired`, 429 `rate_limited`.
   Codes are stored as SHA-256 (`devices.pairing_code`) and marked used via `devices.code_used_at` (never cleared on pair).
3. Server moves the terminal's `device:{id}` sockets into `patient:{id}` and emits `device:paired`, `context:sync`, `settings:sync` to it. The terminal keeps the device_token from step 1.
Logic lives in `server/src/services/pairingService.js`.
Known limitation (state it in the pitch): code-only caregiver auth is a hackathon simplification; production adds caregiver login.

## Routes, start menu and modes (UX)
- `client/src/Root.jsx` picks the app once per page load (`lib/startMode.js` `resolveStart`): `/portal…` → portal, `/` → start menu,
  anything else → terminal (its catch-all goes to `/terminal`).
- `/` start menu (`pages/StartMenu.jsx`): mesh, logo + wordmark + tagline, "Who is using this device?", two cards (≥56px, keyboard
  focus ring; side by side from 700px): "Patient tablet" → `/terminal`, "Caregiver" → `/portal` (its guard sends no-login users to
  `/portal/pair`). EN/ID toggle (UI language only, not stored) and "Remember this choice on this device" (default on).
- Mode memory: localStorage `intacta_mode` = `{mode: 'patient'|'caregiver'}` (try/catch, nothing sensitive), written only by the start
  menu (checkbox on; off clears it). `/` with a stored mode and no `?choose=1` redirects (replaceState) to that app. Direct links to
  `/terminal` and `/portal` always work and never change the stored mode.
- Switching: terminal = hold the header logo 3 s (touch or mouse; a tap does nothing; no visible switch button) → sheet "Switch mode?
  This device will leave the patient screen." Cancel / Switch. Portal = Settings → Account & Security → "Change mode". Both clear the
  stored mode and load `/?choose=1`. NEVER delete `device_token` or the caregiver login (`portal_session`) when switching.
- Audio: choosing "Patient tablet" swaps to the terminal without a reload, and that tap unlocks audio + requests the mic, so the
  "Tap to start" gate is skipped. Direct loads/reloads of `/terminal` keep the gate; if audio is still blocked, the gate comes back.
- Wording: the terminal header button is "Enable caregiver connection" (see Pairing Flow); never "Caregiver mode".

## Socket.IO Contract (keep in sync)
- server → terminal: `context:sync` {payload: {patient_name, language, daily[{id,text}], permanent[{id,text}]}, updated_at}
  (non-volatile; on terminal connect/pair and after every context-items mutation; context is written via REST only)
- server → terminal: `settings:sync` {payload: {strict_validation, max_speech_seconds, voice_gender, playback_speed, volume_db}, updated_at}
  (non-volatile; on terminal connect/pair and after PUT /api/settings)
- terminal → server: `utterance:submit` {transcript}
- server → terminal: `response:ready` {text, parts[], audio_url?}
- server → portal: `interaction:new` {transcript, ai_response, source, created_at}
- server → terminal: `routine:trigger` {id, title, audio_script, category} (scheduler, Asia/Jakarta clock; terminal queues it behind a reply)
- caregiver → server: `broadcast:message` {patientId, text ≤200, safety-checked, 10/min} → terminal `broadcast:message` {text, created_at}
  (+ `interaction:new` source=broadcast; logged + audited; ack {success})
- caregiver → server: `voice:test` {patientId} → terminal `voice:test` {text, language, voice_gender, playback_speed, volume_db}; ack {success}
- server → terminal: `device:paired` {patient_id, language}
- terminal → server: `device:status` {online, battery 0-100, power} → portal `device:status` {device_id, online, battery, power}
Rooms: `device:{id}` (terminal, from connect) and `patient:{id}`. JWT on caregiver sockets (`auth.token`);
device_token on terminal sockets (`auth.device_token`, unpaired devices may connect). Caregiver events check patient ownership.

## REST Contract (keep in sync)
Caregiver JWT (`Authorization: Bearer`), ownership checked on every route (404 unknown patient, 403 another caregiver's):
- `GET /api/context-items?patientId&scope=daily|permanent` → {items} (daily = today only) · `POST` {patientId, scope, text} → 201
  · `PUT /:id` {text} · `DELETE /:id` → 204. Mutations audit + emit `context:sync`.
- `GET /api/settings?patientId` → {settings} (defaults if unset) · `PUT` {patientId, ...any setting} → audit + `settings:sync`.
  Ranges: max_speech_seconds 0-15 (default 10), playback_speed 0.85-1.0 (1.0), volume_db 60-70 (65), voice_gender female|male (female).
- `GET /api/voices` → {voices: [{language, gender, available}]}: never voice IDs (those live only in env).
- `GET /api/tts?text` (≤300 chars; device token via `x-device-token` or `?token=` for `<audio>`, or caregiver JWT + `patientId`)
  → streamed audio/mpeg in the patient's language + voice_gender; 503 {error, code} when the key/voice is missing or ElevenLabs fails; 30/min per device.
- `GET/POST /api/routines`, `GET/PUT/DELETE /api/routines/:id`: also take `title` and `days` (0=Sun..6=Sat, default all).
- `GET /api/patient/status?patientId` → {status: {patient_id, patient_name, language, device: {id, name, online, battery, last_seen_at} | null}}
- `GET /api/interactions?patientId&limit=20(≤100)&before=<id>` → {interactions (newest first), next_before}
Terminal (`x-device-token`): `GET /api/device/context` → {context: {patient_name, daily, permanent}, language, updated_at};
`GET /api/device/settings` → {settings}; `POST /api/respond` {transcript, source} (JSON) or multipart {audio (16 kHz mono WAV),
source:'voice'} → server STT (Gemini audio, `GEMINI_STT_MODEL` else `GEMINI_MODEL`) → chain → {transcript, text, parts, meta};
empty/junk transcript → {transcript:'', text:null, parts:[], meta:{no_speech}} (no reply, not logged); STT failure → 502.
The audio never reaches the LLM chain and is dropped right after transcription (no clip storage exists).
Word cap for LLM output = min(25, round(max_speech_seconds × 2.5)), never below 15; 0 → 25. Enforced on top of the 25-word validator.
`/api/respond` meta: {fallback, fallback_reason, stage (full|retry|static), theme, latency_ms, stt_ms}.
`GET /api/health/llm` (caregiver JWT) → {llm: {window_minutes, total, fallbacks, fallback_rate, top_reasons, p50_ms, p95_ms}} (last hour,
in memory); the server also logs the hourly fallback rate. Fallback replies show a "backup reply" tag in the portal log and the ?dev=1 overlay.

## Figma (source of truth) — file key mIwuaN6ddcgRRLwa9TyMTp
Always: get_design_context + get_screenshot for the node before building. Clip every header to its frame width
(the header rectangle in iPhone frames is 1194 wide by mistake). Export logos as SVG with download_assets; never substitute icons.
- Terminal: 1:2 (home), 62:123 (code popup). Logo group 31:4. Figma is 1194x834 landscape: a reference, the build is fluid.
- Portal (iPhone 17, 402x874; Figma sizes are a reference, legibility wins): Auth 62:171 | Home 29:42 | Routines 60:30 | Context 60:60 |
  Patient 60:120 | Settings 60:90
- Navigation (not in Figma, built from the header tokens; the Menu drawer frame 29:94 is NOT used): same 5 destinations
  (Home, Patient, Routines, Context, Settings), Lucide icons + labels, active item highlighted.
  <1024px: BOTTOM TAB BAR fixed to the bottom, 64px + safe-area-inset-bottom (`.portal-main` pads for it; hidden while the keyboard is open,
  the focused input scrolls into view). ≥1024px: left SIDEBAR RAIL (`SideRail` in TabBar.jsx) instead.

## Type scale (C1) — defined once, used everywhere
- Tokens in `client/src/index.css` (@theme) + `client/src/portal/components/Type.jsx` (Heading / Text / Label / Caption).
  Portal utilities (size + line-height + weight in one): `text-title` 22-26/700/1.2 · `text-card` 16-18/600/1.3 ·
  `text-body` 15-16/400/1.5 · `text-secondary` 13-14/400/1.45 · `text-caption` 12/500/1.35. No ad-hoc `text-[13px]`, no 300/800 in the portal.
- Inter for UI/body; Baloo Da 2 ONLY for the "Intacta" wordmark and the terminal header buttons. Times/numbers: `tabular-nums`.
- Secondary text: `text-muted` (white 80%) on the dark cards/panels (≥6.4:1); directly on the page background (#427aa1) only full white
  (4.6:1). `client/src/lib/__tests__/portalContrast.test.js` keeps every token ≥4.5:1. Max 3 text sizes per card.
- Spacing 4/8/12/16/24 (Tailwind 1/2/3/4/6); radius `rounded-card` (16px) for cards, `rounded-control` (10px) for controls.
- Terminal: Inter ExtraBold greeting/reply, fluid `clamp(24px, 16.6px + 2.05vw, 56px)` (24 phones, ~34 portrait tablet,
  ~41 at 1194, 56 at 1920), line-height 1.25, soft text-shadow; it shrinks (to 16px) until it fits its slot before it ever scrolls.

## Responsive rules (C2)
- Terminal (`client/src/terminal.css`, `TerminalStage` + `TerminalBody`): no fixed stage. 100dvh, safe-area insets, mesh full-bleed.
  Landscape ≥900px: Figma header (logo, wordmark, tagline, the two Baloo buttons, code card under "Authentication code").
  Portrait or <900px: compact header (logo + wordmark + one Menu popover with both actions). The 11 bars are a grid locked to
  the Figma block (1068×210, square corners, one baseline, heights proportional) and scale with the width. The dev typed input
  is in the flow under the header, so nothing overlaps it.
- Portal: mobile-first. Content container max 1100px; ≥768px: Home cards + schedule, Context lists side by side, Patient status | log,
  Settings sections in 2 columns; Routines centered at max 720px. ≥1024px: sidebar rail. Dialogs: bottom sheet <640px,
  centered ≥640px. Pair screen: centered card. Touch targets ≥44px (exception: day toggles 32×44 on phones), no horizontal scroll.
- Check: `npm run check:layout` in `client/` (needs `npm i --no-save playwright-core`, a dev server and PORTAL_TOKEN/PATIENT_ID):
  9 viewports (360x740 … 1920x1080), screenshots + `document.scrollWidth <= innerWidth`.
- Build ONE screen per session; commit after each; update PROGRESS.md. Every screen uses the type scale and responsive rules below.

## Context model (follows Figma, replaces visitor_name/arrival_time/passive_cue)
- context_items(id, patient_id, scope 'daily'|'permanent', text <=200 chars, context_date NULL for permanent, created_at)
- The LLM prompt receives all of today's daily items + all permanent items (FR-4.3.5 fallback when none).
- Server always enforces the clinical guardrails regardless of the "Strict Validation" toggle.

## Language (EN / ID)
- `patients.language` controls LLM output language, TTS voice, terminal static strings, and the banned-phrase list.
- Portal UI language is a separate per-user toggle. Strings live in `/client/src/i18n/{en,id}.json`; no hardcoded UI strings.

## Audio/Voice Rules
- Mic MUST mute while TTS plays and stay muted 3.0s after (FR-4.2.4). State machine: LISTENING → PROCESSING → SPEAKING (muted) → COOLDOWN (3.0s) → LISTENING.
- Discard audio buffers right after transcription (FR-4.2.5).
- dB SPL targets are implemented as calibrated output gain + `noiseSuppression`/`echoCancellation`; never claim measured dB.
- Browsers require one user gesture to unlock audio/mic: the terminal has a one-time "Start" gate, then runs kiosk-style (HTTPS required).
- Keep the hidden typed-utterance input (backtick ` toggles, Esc closes) and the debug overlay (Shift+` / ~ toggles) on the terminal; typed input is the demo fallback.
  Keys are ignored while an input/textarea is focused. `?dev=1` in the URL shows both permanently (tablet has no keyboard).
  (Ctrl+Shift+T / Ctrl+Shift+D are not used: Chrome intercepts them.)
- STT sits behind an `stt` interface so Web Speech API can be swapped for server STT.

## Deployment
- Frontend: Vercel on the .id domain. Backend + Postgres: Railway/Render on `api.<domain>.id`. HTTPS required.
- Socket.IO origin/CORS from env (CLIENT_ORIGIN, API_ORIGIN). Backend cannot run on Vercel (needs a persistent WebSocket server).
- Same demo seed locally and in prod: `npm run db:seed`.

## Git Workflow
- Branch per phase: `phase-N-name`. Commit per screen/feature: `feat(FR-4.3.x): ...`.
- Run `npm test` before every commit. After a phase passes verification, merge to main and tick the checklist above.

## Commands
- `npm run dev`: Express + Vite concurrently
- `npm run dev:backend` (nodemon src/index.js) / `npm run dev:frontend` (vite)
- `npm test`: Jest unit + integration (includes the guardrail suite) in `server/`; Vitest unit tests in `client/` (terminal reply lifecycle, contrast)
- `npm run db:migrate` / `npm run db:seed`
- `npm run llm:try "<utterance>" --lang id|en`: run the LLM pipeline from the CLI with latency
- `npm run llm:bench -- [--timeout ms] [--out file.json]`: 40-utterance × 2-context fallback/latency benchmark on the real model

## Database Schema Keys
- `caregivers` (email + password_hash nullable since migration 004: code-paired caregivers have no login), `patients` (language: id|en; linked to caregiver)
- `devices`: id, device_uid, name (e.g. "Tablet - Ruang Tamu"), patient_id, token_hash, pairing_code (SHA-256), code_expires_at, code_used_at, last_seen_at, battery, is_online
- `context_items`: id, patient_id, scope (daily|permanent), text (≤200), context_date (NULL for permanent), created_at, blocked_category
  (`daily_contexts` is legacy: migration 003 copies today's rows over; no code reads it)
- `routines`: id, patient_id, title, days (SMALLINT[] 0=Sun..6=Sat), trigger_time (TIME), category (ENUM meal|medication|hygiene|other), audio_script (≤300), display_text, is_active, last_fired_on, blocked_category
- `patient_settings`: patient_id (PK), strict_validation, max_speech_seconds, voice_id, playback_speed, volume_db, updated_at
- `interaction_logs`: id, patient_id, transcript, ai_response, source (voice|typed|routine|broadcast), latency_ms, created_at
- `audit_logs`: id, caregiver_id, action, payload (JSONB), created_at (ISO-8601)

## Verification Targets (summary)
- Context sync p95 ≤1.0s (FR-4.1.1); invalid time → 400 field error (FR-4.1.3)
- LLM response ≤1.2s or fallback (FR-4.3.2; see the pending note under Clinical Guardrails); fallback rate <10%; 100% guardrail compliance
- STT ≤800ms after utterance end (FR-4.2.2); TTS first byte ≤500ms (FR-4.4.1)
- Mic never captures during SPEAKING or the 3.0s COOLDOWN
- Terminal contrast ≥7:1, font ≥32pt (NOTE 2026-10-21: the fluid reply font is 24px on phones / ~34px on a portrait tablet, by request;
  ≥40px at 1194 wide. Decision pending); returns to clock mode 60s after audio ends

## Progress Log Rule (handoff)
- Keep /PROGRESS.md up to date: current phase, what is DONE, what is IN PROGRESS (file paths), what is NEXT, known bugs.
- Update it after EVERY completed feature or screen, and before ending any session.
- Commit often (small commits). Never leave a feature half-written and uncommitted.
- When starting a session, read PROGRESS.md first and continue from "NEXT".