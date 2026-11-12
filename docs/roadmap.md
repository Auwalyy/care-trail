# CARETRAIL — Roadmap & Status

Status legend: ✅ done and tested · 🟡 in progress · ⬜ not started

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture, data model, API contracts, navigation, risks | ✅ (docs/) |
| 1 | Foundation: monorepo, TS config, API skeleton, MongoDB connection, logging, error handling, env config, shared packages, Next.js + Expo setup | ✅ code and tests. Real-device run and Docker run still pending (see README). |
| 2 | Auth & access control: users, Argon2id, JWT + rotating refresh, RBAC, scopes, protected routes (API + web) | ✅ API tests and live end-to-end run. Web UI not clicked through in a browser. |
| 3 | Core admin: organisations, facilities, communities, CHW profiles, programme settings, audit viewer, dashboard figures | ✅ API tests and live end-to-end run. Web UI not clicked through in a browser. Per-CHW patient and task counts move to Phases 4 and 6. |
| 4 | Patients: registration, households, consent, profiles, search, duplicate detection | ✅ API tests and live end-to-end run (incl. log scan). Web UI not clicked through in a browser. |
| 5 | Referrals: creation, codes, receipts, verification, transitions, history | ✅ API tests and live end-to-end run (incl. log scan). Web UI not clicked through in a browser. |
| 6 | Appointments & follow-up: scheduling, attendance, missed-care job, tasks, escalation | ✅ API tests and live end-to-end run (scheduler observed). Web UI not clicked through in a browser. |
| 7 | Mobile app: auth, dashboard, patients, visits, referrals, appointments, profile, i18n | ✅ code, typecheck and Android bundle. **Not run on a device or emulator.** |
| 8 | Offline engine: SQLite/SQLCipher, outbox, push/pull, idempotency, conflicts, retries, sync UI | ✅ engine + API tested end to end in Node. SQLite store and UI **not run on a device**. |
| 9 | Education CMS & notifications (SMS/voice/push/in-app abstraction) | ✅ API tests and live end-to-end run (incl. log scan). No real SMS/voice provider (none contracted); push not built. Web UI not clicked through in a browser. |
| 10 | Analytics & exports | ✅ API tests and live end-to-end run. Web UI not clicked through in a browser. |
| 11 | QA: security, performance, offline, E2E | 🟡 next |
| 12 | Deployment: Docker, backups, monitoring, EAS Android build | ⬜ |

## Status details

See the README "Phase status" section for what has been verified and how.
