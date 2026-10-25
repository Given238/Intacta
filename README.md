# Intacta: ambient AI assistant for dementia care

Intacta is a touchless voice companion for people with dementia, with a mobile portal for their caregivers. The patient talks to a tablet. It listens, replies in a calm, short, reassuring way, and speaks the reply aloud. Caregivers add the facts, routines and settings it may use, and review conversations from their phone.

**Live demo:** https://intacta.id
**Source code:** https://github.com/Given238/Intacta

## How to try it (about 2 minutes)

1. On a tablet or laptop, open https://intacta.id and choose **Patient tablet**. Allow microphone access. A 6-character pairing code appears on screen.
2. On your phone, open https://intacta.id and choose **Caregiver**. Enter the code or scan the QR code.
3. In the portal, add a context note (for example, a family member's name or where something is) and a routine.
4. Speak to the tablet. Replies use only the facts the caregiver provided. Conversations and audio clips appear in the portal's logs.

## Key features

- Voice conversation in Bahasa Indonesia and English
- Replies follow dementia-care rules: validate, reassure, redirect. They are short and never quiz or correct the patient.
- Replies use only caregiver-provided facts, so nothing is invented.
- Caregiver-written text is screened for safety before it reaches the patient.
- Routine reminders, plus a caregiver dashboard with playable conversation clips
- Runs on any tablet or phone, with no special hardware

## Tech stack

React, Vite, Tailwind, Express, Socket.IO, PostgreSQL (Neon), Gemini, ElevenLabs. Hosted on Vercel and Render.

## Run locally

```bash
# server
cd server
cp .env.example .env     # fill in your own keys
npm install
npm run migrate
npm run dev

# client (new terminal)
cd client
npm install
npm run dev
```

The client reads `VITE_API_URL` from `client/.env.development` (default `http://localhost:3000`). Never commit real keys; `.env` files are gitignored.

## Submission links

In case PDF + video doesn't work, here are the links:

- Canva: https://www.canva.com/design/DAHXgaUboNg/a9p58mREb7mPbbJet0pdNQ/edit
- YouTube: (add link)
