# CARETRAIL — Roadmap & Status

Status legend: ✅ done and tested · 🟡 in progress · ⬜ not started

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture, data model, API contracts, navigation, risks | ✅ (docs/) |
| 1 | Foundation: monorepo, TS config, API skeleton, MongoDB connection, logging, error handling, env config, shared packages, Next.js + Expo setup | ✅ code and tests. Real-device run and Docker run still pending (see README). |
| 2 | Auth & access control: users, Argon2id, JWT + rotating refresh, RBAC, scopes, protected routes (API + web) | ✅ API tests and live end-to-end run. The web UI was not clicked through in a browser (see README). |
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

## Status details

See the README "Phase status" section for what has been verified and how.

## Phase 3 plan (next): core administration

1. **Organisations** (platform admin): create, update, activate/deactivate, audit.
2. **Communities and facilities**: create, update and soft-delete within an organisation, with
   unique codes. Deactivating one with active users or patients needs an explicit reassignment.
3. **CHW profiles** (`chws` collection): programme areas, `canIssueReferrals` flag, supervisor,
   device and sync status fields (populated in Phase 8), plus an assigned-patients count.
4. **Settings**: per-organisation pilot targets (communities, facilities, CHWs, patients,
   duration, start date), referral expected-arrival default and offline grace period, editable
   without code changes.
5. **Audit log viewer**: `GET /audit-logs` (`audit:read`), scoped, with filters.
6. **Web**: Organisations, Facilities, Communities, CHWs, Settings and Audit pages. The dashboard
   shows real counts of facilities, communities and CHWs against pilot targets.
7. **Tests**: CRUD validation, uniqueness, scope isolation for each module, soft deletion,
   settings permissions.
