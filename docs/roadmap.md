# CARETRAIL — Roadmap & Status

Status legend: ✅ done and tested · 🟡 in progress · ⬜ not started

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture, data model, API contracts, navigation, risks | ✅ (docs/) |
| 1 | Foundation: monorepo, TS config, API skeleton, MongoDB connection, logging, error handling, env config, shared packages, Next.js + Expo setup | ✅ code and tests. Real-device run and Docker run still pending (see README). |
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

## Phase 2 plan (next)

1. `users` and `refresh_tokens` models. Argon2id hashing (the `argon2` package needs a
   native build, so verify it installs in the Alpine image, with `@node-rs/argon2` as fallback).
2. `POST /auth/login|refresh|logout|forgot-password|reset-password`, `GET /auth/me`. Rotating
   refresh tokens with family reuse detection, and revocation on deactivation or reset.
3. `authenticate` and `authorize(permission)` middleware. `buildAccessScope(user)` and
   scope-required repository signatures.
4. Audit log module, which login and logout write to.
5. Seed script for the first platform admin (interactive, no default password).
6. Web: login, forgot/reset pages, in-memory access token with httpOnly refresh cookie, protected
   `(dashboard)` layout, role-based redirects.
7. Tests: login and lockout, refresh rotation and reuse, permission denials per role, deactivated
   user, password reset revoking sessions.
