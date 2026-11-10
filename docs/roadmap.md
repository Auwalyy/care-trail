# CARETRAIL — Roadmap & Status

Status legend: ✅ done and tested · 🟡 in progress · ⬜ not started

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture, data model, API contracts, navigation, risks | ✅ (docs/) |
| 1 | Foundation: monorepo, TS config, API skeleton, MongoDB connection, logging, error handling, env config, shared packages, Next.js + Expo setup | see below |
| 2 | Auth & access control: users, Argon2id, JWT + rotating refresh, RBAC, scopes, protected routes (API + web) | ⬜ |
| 3 | Core admin: organisations, communities, facilities, CHWs, settings, dashboard shell | ⬜ |
| 4 | Patients: registration, households, consent, profiles, search, duplicate detection | ⬜ |
| 5 | Referrals: creation, codes, receipts, verification, transitions, history | ⬜ |
| 6 | Appointments & follow-up: scheduling, attendance, missed-care job, tasks, escalation | ⬜ |
| 7 | Mobile app: auth, dashboard, patients, visits, referrals, appointments, profile | ⬜ |
| 8 | Offline engine: SQLite/SQLCipher, outbox, push/pull, idempotency, conflicts, retries, sync UI | ⬜ |
| 9 | Education CMS & notifications (SMS/voice/push/in-app abstraction) | ⬜ |
| 10 | Analytics & exports | ⬜ |
| 11 | QA: security, performance, offline, E2E | ⬜ |
| 12 | Deployment: Docker, backups, monitoring, EAS Android build | ⬜ |

## Phase 1 checklist

See the README "Phase 1 status" section for what has been verified.
