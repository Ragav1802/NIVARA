# NIVARA — Listen. Understand. Support.

## Problem Statement
AI-powered support platform for people in distress with three roles: Victim, Officer, Counsellor. Multilingual (English/Tamil/Hindi/Tanglish/Hinglish). Real-time emergency alerts with location, AI voice + chat, SVI risk scoring, case flow from AI intake → officer response → counsellor follow-up.

## Architecture
- **DB**: MariaDB (MySQL) via SQLAlchemy async (aiomysql). Tables: users, cases, interactions, analysis_results, officer_actions, counsellor_notes, followups, notifications, consents, audit_logs
- **Backend**: FastAPI + JWT auth + WebSockets (`/api/ws`) + Claude Sonnet 4.6 (via emergentintegrations) + OpenAI Whisper STT + OpenAI TTS
- **Frontend**: React + Tailwind, three distinct role UIs (victim orb / officer live center / counsellor journey), Leaflet map, i18n

## Personas
- **Victim** — private, anxious, needs voice-first calm companion + SOS
- **Officer** — needs tactical map, priority queue, quick assign
- **Counsellor** — needs case timeline, notes, follow-ups

## Implemented (Aug 2026)
- Auth: register/login/me with role-based JWT
- Victim: AI voice (Whisper + TTS), AI chat with SVI scoring, SOS with geolocation, case status, follow-ups, settings (language switch EN/TA/HI)
- Officer: Live Response Center with Leaflet dark map, priority queue, active cases, transcript viewer, AI assessment panel, AI summary, actions (contact/dispatch), counsellor assignment, realtime WS feed
- Counsellor: Case journey with timeline (interactions+actions+notes), AI summary generation, counselling notes, follow-up scheduling, resolve action
- Real-time WebSocket: SOS broadcast to officers, case_assigned to counsellors, status_change/followup to victims
- Demo users seeded on startup

## Backlog
- P1: Full transcripts collection + audio storage
- P1: Voice analysis metrics (pauses, pitch) as supplementary signals
- P1: Consent flow prompts before mic/location
- P2: Video analysis with consent (skipped for v1)
- P2: Officer role assignment radius
- P2: Multi-officer routing based on nearest location
