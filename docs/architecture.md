# CARETRAIL — System Architecture

> No Patient Left Behind. Offline-first community healthcare navigation, referral and follow-up.

CARETRAIL is a **care coordination** platform. It does not diagnose, prescribe or make clinical
decisions. Every clinical artefact it distributes (education content, referral instruction
templates, appointment schedule templates, escalation procedures) is configured by administrators
and must carry a recorded clinical approval before it can be used.

## 1. System context

```
                ┌──────────────────────┐        SMS / voice (provider abstraction)
 Patients  ◄────┤  Notification worker ├──────► Gateway (e.g. Africa's Talking, Termii — TBD)
 (no app)       └─────────▲────────────┘
                          │ BullMQ (Redis)
┌──────────────┐   HTTPS  │                         ┌─────────────────┐
│ CHW mobile   ├──────────►┌────────────────────┐   │ MongoDB         │
│ Expo/Android │  /sync    │  CARETRAIL API     ├──►│ (replica set —  │
│ SQLite+outbox│◄──────────┤  Express 5 / TS    │   │  transactions)  │
└──────────────┘           │  modular monolith  │   └─────────────────┘
┌──────────────┐   HTTPS   │                    ├──► S3-compatible storage (audio)
│ Web admin    ├──────────►│                    │
│ Next.js 16   │◄──────────┤                    ├──► Redis (queues, rate limits)
└──────────────┘           └────────────────────┘
```

* **One API process** (modular monolith) plus a **worker process** running BullMQ jobs from the
  same codebase (`server.ts` and `worker.ts` entry points). No microservices.
* **Web** (Next.js App Router) is the administration surface for platform, programme and facility
  roles. It is a client of the REST API; it holds no secrets and uses no server-side database access.
* **Mobile** (Expo, Android-first) is the CHW field tool. It is offline-first: SQLite is the
  source of truth for the UI; the network is a sync channel.
* **Patients** have no accounts in the MVP. They interact via printed referral receipts, SMS,
  voice messages and their CHW.

## 2. Monorepo layout

```
apps/
  api/      Express API + background worker
  web/      Next.js admin web app
  mobile/   Expo CHW app
packages/
  shared-types/  Enums, roles, permissions, domain state machines, API envelope types (pure TS)
  validation/    Zod schemas shared by API, web and mobile
  api-client/    Typed fetch client used by web and mobile
docs/
```

npm workspaces. Shared packages compile with `tsc` to `dist/` (ESM + `.d.ts`); apps consume the
built output. `npm run build:packages` runs before any app build or dev server.

### Version matrix (verified against the npm registry, 2026-11-10)

| Area | Choice | Notes |
|---|---|---|
| Node | ≥ 22.13 (dev machine: 26) | Expo 58 engines: `^22.13 \|\| ^24.3 \|\| ^26` |
| TypeScript | **6.0.x** | TS 7 (native Go port) is `latest`, but Next.js/Expo/ESLint tooling depend on the JS compiler API. Revisit once those ecosystems certify TS 7. |
| API | Express 5.3, Mongoose 9.12, Zod 4, pino 10, helmet 8 | |
| Web | Next.js 16, React 19, Tailwind **4**, shadcn/ui | |
| Mobile | Expo SDK 58, Expo Router, NativeWind **4.2** + Tailwind **3.4** | NativeWind 4 targets Tailwind v3; NativeWind 5 (Tailwind v4) is still RC. Mobile pins its own Tailwind 3 copy. |
| Tests | Vitest, Supertest, mongodb-memory-server (replica set) | |

## 3. Backend module design (clean architecture per module)

```
src/modules/<module>/
  <module>.model.ts        Mongoose schema + indexes (persistence only)
  <module>.repository.ts   All queries; every query takes an AccessScope
  <module>.service.ts      Business rules, transactions, audit, events
  <module>.controller.ts   HTTP ↔ service mapping, no business logic
  <module>.routes.ts       Route table + authenticate + authorize(permission) + validate(schema)
  <module>.types.ts        Module-internal types
  (validation schemas live in packages/validation so mobile/web share them)
```

Modules: auth, users, organisations, communities, facilities, patients, households, consent,
chws, visits, referrals, appointments, follow-ups, education, notifications, analytics, sync,
audit, settings (pilot/programme configuration).

### Cross-cutting middleware pipeline

`requestId → pino-http (redacted) → helmet → cors(allowlist) → rate limit → json(limit) →
authenticate → authorize(permission) → validate(zod) → controller → errorHandler`

### Access scoping (data isolation)

Authorization has two layers, both enforced on the server:

1. **Permission check** — `authorize('referral:update-status')` from a static role→permission map
   in `packages/shared-types`.
2. **Resource scope** — `buildAccessScope(user)` returns the boundary filter that every repository
   query must include:

| Role | Scope |
|---|---|
| `platform_admin` | all organisations (patient-identifiable lists still audited) |
| `programme_admin` | `organisationId` (+ optional `communityIds` assigned) |
| `facility_admin`, `facility_worker` | `organisationId` + `facilityId`; patients visible only through referrals/appointments addressed to their facility |
| `chw` | `organisationId` + assigned `communityIds`; patients where `assignedChwId = self` (plus patients they registered pending reassignment) |

Repositories never accept a raw filter without a scope — the type signature requires it, so a
forgotten scope is a compile error, not a data leak.

## 4. Key domain flows

### Closed-loop referral

```
ISSUED ──► PATIENT_ARRIVED ──► SERVICE_RECORDED ──► COMPLETED
   │              │                    └──────────► FOLLOW_UP_REQUIRED ──► COMPLETED
   └──► CANCELLED (issuer/admin, with reason, only before arrival)
   └──► EXPIRED   (system, when expected arrival window lapses → follow-up task created)
```

* The transition table lives in `packages/shared-types` (`REFERRAL_TRANSITIONS`) and is used by the
  API (authoritative), the web UI and mobile UI (to show only legal actions).
* Every transition writes a `referral_events` document (actor, role, facility, timestamp, from,
  to, note) **in the same transaction** as the status update; the referral carries a `version`
  for optimistic concurrency.
* Referral codes are server-generated: `CT-XXXX-XXXX` in Crockford base32 (no I/L/O/U) with a
  mod-37 check character, so typing errors at the facility are caught before lookup.
* Offline-created referrals show a receipt marked **"PENDING SYNC — not yet valid at facility"**
  with a local reference. No code is invented offline.

### Missed-care recovery

A scheduled job (BullMQ repeatable, every 15 min; also runnable on demand) detects: appointments
past their date without attendance, referrals past `expectedArrivalBy` without arrival, referrals
stuck in `SERVICE_RECORDED`/`FOLLOW_UP_REQUIRED`, and follow-up tasks past due. It upserts a
follow-up task keyed by `(sourceType, sourceId, reason)` so repeated runs never duplicate tasks.

Task lifecycle: `PENDING → ASSIGNED → IN_PROGRESS → CONTACTED → RESOLVED`, with `ESCALATED`
reachable from any open state. Escalation targets are configured per programme — CARETRAIL does
not invent clinical escalation procedures.

### Notifications

`NotificationService.enqueue()` → `notifications` document (status `QUEUED`) → BullMQ job →
`ChannelProvider` (`SmsProvider`, `VoiceProvider`, `PushProvider`, `InAppProvider`) → status
`SENT/DELIVERED/FAILED` with exponential-backoff retries and delivery callbacks. SMS bodies are
built from approved templates containing **no clinical details** (e.g. "You have a visit at
{facility} on {date}. Ref {code}."). Without configured credentials the `LogOnlyProvider` is used
and messages are marked `NOT_SENT_NO_PROVIDER` — never reported as delivered.

## 5. Offline-first mobile

See [offline-sync.md](offline-sync.md) for the protocol. In summary: SQLite (SQLCipher-encrypted,
key in SecureStore) holds assigned patients and the CHW's working set; every mutation is written to
the local table **and** an `outbox` row in one SQLite transaction; a sync service pushes outbox
batches with idempotency keys, then pulls server changes since a cursor.

## 6. Security & data protection (NDPA 2023)

* Passwords: Argon2id. Access token JWT 15 min; refresh token opaque, rotated on every use,
  stored hashed, reuse detection revokes the whole token family.
* Session revocation on deactivation / password reset.
* Rate limiting on auth and sync endpoints; helmet; CORS allowlist; body size limits.
* PII redaction in logs (pino `redact` + no request bodies logged).
* Audit log for every read of a patient profile and every mutation of patient, consent, referral.
* Consent: recorded per purpose (care coordination, SMS, voice, data sharing with facility) with
  version of the consent text, method (verbal/thumbprint/signature), witness CHW, timestamp.
  SMS/voice sending checks consent at send time.
* Data minimisation: only fields required by the workflow; mobile stores only assigned patients
  and purges records when reassigned.
* Encryption at rest: MongoDB with encrypted storage / managed provider encryption; SQLCipher on
  device; TLS everywhere.
* Retention: configurable retention periods per collection (values require programme/legal
  decision — see [decisions.md](decisions.md)).

## 7. Deployment

Docker images for `api` (also runs `worker` with a different command) and `web`; MongoDB as a
replica set (transactions); Redis; S3-compatible storage (MinIO locally). Android build via EAS.
