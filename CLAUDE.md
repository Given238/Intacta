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
- LLM returns structured JSON {validate, reassure, redirect}. A validator rejects any `?`, banned phrases, >25 words, or empty parts. One retry, then a fallback script.
- Banned phrases (both languages): id: ingat, sudah dibilang, tadi kan, salah, bukan begitu. en: remember, I told you, as I said, wrong.
- Timeout (1.2s), API error, or double rejection → themed fallback script (visitor / anxiety / disorientation / generic), per language.
- Missing context params → generic comforting phrase, never an error (FR-4.3.5).
- Any change to prompts or the validator requires the guardrail suite to pass.

## Code Conventions
- Controllers atomic and thin; logic lives in /services.
- Explicit try/catch + typed error responses on every DB transaction and LLM call. Never swallow errors.
- Validate input at the boundary (zod). Invalid time → 400 with a field-level error (FR-4.1.3).
- Every caregiver mutation writes an audit log (caregiver_id + ISO-8601 timestamp).
- Secrets only in .env (GEMINI_API_KEY, ELEVENLABS_API_KEY, JWT_SECRET, DATABASE_URL, CLIENT_ORIGIN, API_ORIGIN). Gemini and ElevenLabs are called from the server only, never from the browser.
- Terminal localStorage is limited to: device_token and the 24h context cache.

## Pairing Flow (code-based, replaces QR)
1. Terminal "Caregiver mode → Enter" calls `POST /api/devices/register` → `{device_id, device_token, code}`. Code is 6 chars (shown like `dev-d4y`), TTL 10 min, single use, regenerates on expiry.
2. Caregiver enters the code on the phone → `POST /api/pair {code}` (rate-limited 5/min/IP) → returns a caregiver JWT scoped to that patient and links the device.
3. Server emits `device:paired` to the terminal, which joins `patient:{id}` using its device_token.
Known limitation (state it in the pitch): code-only caregiver auth is a hackathon simplification; production adds caregiver login.

## Socket.IO Contract (keep in sync)
- caregiver → server: `context:update` {visitor_name, arrival_time, passive_cue}
- server → terminal: `context:sync` {payload, updated_at}
- terminal → server: `utterance:submit` {transcript}
- server → terminal: `response:ready` {text, parts[], audio_url?}
- server → portal: `interaction:new` {transcript, ai_response, source, created_at}
- server → terminal: `routine:trigger` {audio_script, category}
- caregiver → server → terminal: `broadcast:message` {text}
- server → terminal: `device:paired` {patient_id}
- terminal → server: `device:status` {online, battery, power}
Rooms: `patient:{id}`. JWT on caregiver sockets; device_token on terminal sockets.

## Figma (source of truth where it exists)
File key: `mIwuaN6ddcgRRLwa9TyMTp`
- Patient terminal: node `1:2` (home) and `62:123` (pairing-code popup). Landscape 1194x834 (iPad Pro 11"). Scale with vw/vh, never fixed px.
- Auth screen: node `62:171` (mobile, 402x874).
- NOT designed (build from the spec using tokens extracted from the frames above; portal accent #0D6C8C): portal Patient / Context / Routines / Settings, terminal clock mode, response view, visitor banner.
- Load the figma-design-to-code skill before every `get_design_context` call. Always fetch the screenshot.
- The 12-bar waveform in the terminal frame is a live voice visualizer: drive bar heights from mic amplitude (listening) and TTS amplitude (speaking).

## UI Rules
- Terminal: ≥7:1 contrast, ≥32pt text, no touch needed during normal use (only pairing and the one-time Start gate).
- Portal: mobile-first at 390px. Bottom tab bar: Patient, Routines, Context, Settings.
- Use placeholder data (Ibu Sari, visitor "Budi", arrival "11:00 AM", cue "Budi sedang membeli makanan kesukaan Ibu") until wired; mark with `// TODO(wire)`.
- Build screen by screen; one commit per screen.

## Language (EN / ID)
- `patients.language` controls LLM output language, TTS voice, terminal static strings, and the banned-phrase list.
- Portal UI language is a separate per-user toggle. Strings live in `/client/src/i18n/{en,id}.json`; no hardcoded UI strings.

## Audio/Voice Rules
- Mic MUST mute while TTS plays and stay muted 3.0s after (FR-4.2.4). State machine: LISTENING → PROCESSING → SPEAKING (muted) → COOLDOWN (3.0s) → LISTENING.
- Discard audio buffers right after transcription (FR-4.2.5).
- dB SPL targets are implemented as calibrated output gain + `noiseSuppression`/`echoCancellation`; never claim measured dB.
- Browsers require one user gesture to unlock audio/mic: the terminal has a one-time "Start" gate, then runs kiosk-style (HTTPS required).
- Keep the hidden typed-utterance input (Ctrl+Shift+T) and the debug overlay (Ctrl+Shift+D) on the terminal; typed input is the demo fallback.
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
- `npm test`: Jest unit + integration (includes the guardrail suite)
- `npm run db:migrate` / `npm run db:seed`
- `npm run llm:try "<utterance>" --lang id|en`: run the LLM pipeline from the CLI with latency

## Database Schema Keys
- `caregivers`, `patients` (language: id|en; linked to caregiver)
- `devices`: id, patient_id, token_hash, pairing_code, code_expires_at, last_seen_at, battery, is_online
- `daily_contexts`: patient_id, visitor_name, arrival_time (VARCHAR, validated), passive_cue (TEXT), updated_at
- `routines`: id, patient_id, trigger_time (TIME), category (ENUM meal|medication|hygiene), audio_script, is_active
- `interaction_logs`: id, patient_id, transcript, ai_response, source (voice|typed|routine|broadcast), latency_ms, created_at
- `audit_logs`: id, caregiver_id, action, payload (JSONB), created_at (ISO-8601)

## Verification Targets (summary)
- Context sync p95 ≤1.0s (FR-4.1.1); invalid time → 400 field error (FR-4.1.3)
- LLM response ≤1.2s or fallback (FR-4.3.2); 100% guardrail compliance
- STT ≤800ms after utterance end (FR-4.2.2); TTS first byte ≤500ms (FR-4.4.1)
- Mic never captures during SPEAKING or the 3.0s COOLDOWN
- Terminal contrast ≥7:1, font ≥32pt; returns to clock mode 60s after audio ends