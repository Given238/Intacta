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
/client            React app (routes: /portal/*, /terminal)
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
  non-Latin script. The chain also rejects: over the patient cap; food/drink in the redirect when not allowed; an unsafe reply (Content Safety).
- Banned patterns (examples): id: kamu lupa, sudah kubilang/dibilang, tadi kan, apa kamu ingat, ingat tidak, bukan begitu, kamu salah,
  sebenarnya. en: you forgot, I told you, as I said, do you remember, that's wrong, you're wrong, actually. A validating phrase like
  "tidak salah kok merasa begitu" passes.
- Reply ladder (`llm/chain.js`): (1) full prompt, `LLM_TIMEOUT_MS` (default 2500); (2) ONE retry with the short prompt + the rejection
  reason, 2 s (skipped for 400/401/403/404); (3) static fallback from `llm/fallbacks.js`: 15 situation categories × 4 variants of each
  part × 2 languages, chosen by keyword intent (generic last), random, never reusing a piece from the last 3 replies, within the word
  cap; presence statements only; food only in hungry/thirsty. Fallbacks carry `_fallback: true`, `_reason`
  (timeout | api_error:<status> | validation:<rule> | safety | empty) and are logged with latency.
  NOTE (2026-10-21, decision pending): FR-4.3.2 says ≤1.2 s or fallback; the measured model latency does not fit that, so the
  default first-attempt budget is now 2500 ms + a 2 s retry. Confirm or restore.
- Missing context params → generic comforting phrase, never an error (FR-4.3.5).
- Any change to prompts or the validator requires the guardrail suite to pass (`npm test`); live checks: `RUN_LIVE_LLM_TESTS=1 npm test`.

## Content Safety (NON-NEGOTIABLE): text that reaches the patient
- One module: `server/src/services/contentSafety.js` → `checkPatientFacingText(text, {language, kind})` → `{ok, category, reason}`;
  kind = context | broadcast | routine | voice_test | reply. Max 300 chars.
- Tier 1: whole-word rules (ID + EN) on normalised text (lowercase, accents/punctuation stripped, leetspeak `b0m`, stretched letters).
  Instruction-type rules are skipped after a negation (`jangan`, `don't`…) so calm reminders pass ("Jangan sentuh kompor ya").
  Death/accident facts block only spoken kinds (a context note may hold them as background); hospital/illness/death block AI replies.
- Tier 2: Gemini classifier `{safe, category, confidence}` (blocks at confidence ≥0.7), 2.5 s timeout, `GEMINI_SAFETY_MODEL` else `GEMINI_MODEL`.
  If it fails or times out, Tier 1 alone decides and `[safety]` is warned. Never runs under NODE_ENV=test.
- Categories: threat_violence, fear_inducing, self_harm, abuse_insult, sexual, deception_harm, unsafe_instruction, other.
- Enforced BEFORE saving/emitting (Tier 1 + 2): POST/PUT context-items, routines create/update (title, audio_script, display_text),
  `broadcast:message`, `voice:test`. Refusal: REST 422 `{error, code:'unsafe_content', category}`; socket ack
  `{success:false, code:'unsafe_content', category}`. Audit `content.blocked` with `{kind, category}` only, never the text.
  Broadcasts: 10/min per caregiver (ack `code:'rate_limited'`).
- Stored rows are re-checked (Tier 1) when the LLM context / terminal snapshot is built, when the portal lists them and on every
  scheduler tick; failures get `blocked_category` (migration 007), are never sent or spoken, and show "Blocked for safety" in the portal
  (still editable/deletable).
- Every AI reply is Tier-1 checked; a failure goes down the fallback path. Prompts wrap the patient's words and the notes in
  `<<<PATIENT … PATIENT>>>` / `<<<NOTES … NOTES>>>` as DATA, never instructions; the AI never states deaths, threats, illness or hospital.
- Portal shows the refusal inline ("could frighten or upset the patient… e.g. 'Timothy akan pulang jam 5.'"), never the rule list.

## Code Conventions
- Controllers atomic and thin; logic lives in /services.
- Explicit try/catch + typed error responses on every DB transaction and LLM call. Never swallow errors.
- Validate input at the boundary (zod). Invalid time → 400 with a field-level error (FR-4.1.3).
- Every caregiver mutation writes an audit log (caregiver_id + ISO-8601 timestamp).
- Secrets only in .env (GEMINI_API_KEY, ELEVENLABS_API_KEY, JWT_SECRET, DATABASE_URL, CLIENT_ORIGIN, API_ORIGIN). Gemini and ElevenLabs are called from the server only, never from the browser.
- Terminal localStorage is limited to: device_token and the 24h context cache.

## Pairing Flow (code-based, replaces QR)
1. Terminal "Caregiver mode → Enter" calls `POST /api/devices/register` → `{device_id, device_token, code}`. Code is 6 chars (shown like `dev-d4y`), TTL 10 min, single use, regenerates on expiry.
2. Caregiver enters the code on the phone → `POST /api/devices/pair {code}`: PUBLIC (no login), rate-limited 5/min/IP.
   No Authorization header → a new caregiver (email/password NULL) + patient are created (or the device's existing patient is kept).
   With a caregiver JWT ("Pair New Tablet") → the device links to that caregiver's patient. A bad JWT → 401.
   Returns `{success, token, patient_id, language, device_name}`; token = caregiver JWT {caregiverId, patientId}. Audited `device.pair`.
   Errors `{error, code}`: 400 `code_required`/`invalid_code`, 409 `code_used`, 410 `code_expired`, 429 `rate_limited`.
   Codes are stored as SHA-256 (`devices.pairing_code`) and marked used via `devices.code_used_at` (never cleared on pair).
3. Server moves the terminal's `device:{id}` sockets into `patient:{id}` and emits `device:paired`, `context:sync`, `settings:sync` to it. The terminal keeps the device_token from step 1.
Logic lives in `server/src/services/pairingService.js`.
Known limitation (state it in the pitch): code-only caregiver auth is a hackathon simplification; production adds caregiver login.

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
- Terminal: 1:2 (home), 62:123 (code popup). Logo group 31:4. 1194x834 landscape, scale with vw/vh.
- Portal (iPhone 17, 402x874, build at 390-402px): Auth 62:171 | Home 29:42 | Routines 60:30 | Context 60:60 |
  Patient 60:120 | Settings 60:90
- Navigation: BOTTOM TAB BAR (Home, Patient, Routines, Context, Settings), not designed in Figma: build it from the header tokens.
  Fixed to the bottom, ~64px + safe-area-inset-bottom, active tab highlighted, Lucide icons + labels. The Menu drawer frame 29:94 is NOT used.
  Scroll areas need bottom padding for the bar. Hide the bar or keep inputs visible when the keyboard is open (Context inputs, Speak Now).
- Build ONE screen per session; commit after each; update PROGRESS.md.

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
- Terminal contrast ≥7:1, font ≥32pt; returns to clock mode 60s after audio ends

## Progress Log Rule (handoff)
- Keep /PROGRESS.md up to date: current phase, what is DONE, what is IN PROGRESS (file paths), what is NEXT, known bugs.
- Update it after EVERY completed feature or screen, and before ending any session.
- Commit often (small commits). Never leave a feature half-written and uncommitted.
- When starting a session, read PROGRESS.md first and continue from "NEXT".