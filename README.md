# CARETRAIL — No Patient Left Behind

Offline-first community healthcare navigation, referral and follow-up platform. The initial focus
is pregnant women, new mothers and newborns in Kano State, Nigeria.

> CARETRAIL coordinates care. It does **not** diagnose, prescribe or replace qualified healthcare
> professionals. Clinical content, referral instruction templates, appointment schedules and
> escalation procedures are configured by the programme and require a recorded clinical approval.
> None ship with the platform.

| App / package | Purpose | Stack |
|---|---|---|
| `apps/api` | REST API and (later) background worker | Express 5, Mongoose 9, Zod 4, pino |
| `apps/web` | Admin web app (platform, programme, facility roles) | Next.js 16, Tailwind 4, TanStack Query |
| `apps/mobile` | Community Health Worker app, offline-first | Expo SDK 58, Expo Router, NativeWind 4 |
| `packages/shared-types` | Roles, permissions, enums, referral/follow-up state machines, referral codes | TypeScript |
| `packages/validation` | Zod schemas shared by all apps | Zod 4 |
| `packages/api-client` | Typed fetch client for web and mobile | TypeScript |

Design documents are in [docs/](docs/):
- [architecture](docs/architecture.md)
- [data model](docs/data-model.md)
- [API contracts](docs/api-contracts.md)
- [offline sync](docs/offline-sync.md)
- [navigation](docs/navigation.md)
- [decisions & risks](docs/decisions.md)
- [roadmap](docs/roadmap.md)

## Prerequisites

- Node.js **22.13+** (24 or 26 also work), npm 10+
- MongoDB **running as a replica set**, because transactions are required. Use the Compose
  service or a managed cluster. A standalone `mongod` is rejected at startup.
- For the mobile app: an Android device or emulator with a development build. Expo Go is fine for
  Phase 1, but later phases add native modules (SQLCipher).

## Getting started

```bash
npm install
cp apps/api/.env.example apps/api/.env       # adjust MONGODB_URI if needed
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env # set your LAN IP for a physical device

docker compose up -d mongo redis             # MongoDB replica set + Redis

npm run create-admin -w @caretrail/api   # first platform administrator (prompts; no default password)
npm run seed:dev -w @caretrail/api       # optional: DEMO organisation/facilities/communities (dev only)

npm run dev:api      # http://localhost:4000  (Swagger UI: /api/docs)
npm run dev:web      # http://localhost:3000
npm run dev:mobile   # Expo dev server
```

`apps/api/.env` must contain `JWT_ACCESS_SECRET` (≥ 32 characters). Generate one with
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
In a production container run the compiled script instead:
`node dist/scripts/create-platform-admin.js`.

### Onboarding people

Admins never choose passwords for others. Creating a user returns a **one-time activation link**
(valid 7 days). Hand it to the person, who opens it and sets their own password. For a forgotten
password, an administrator issues a reset link from **Users → ⋯ → Issue password reset link**
(valid 24 h). Self-service "Forgot password" also works, but emails are not delivered until a
provider is configured (Phase 9).

**Production:** the refresh cookie is `SameSite=Strict`, so host the web app and API on the same
registrable domain (e.g. `app.example.org` and `api.example.org`) over HTTPS.

Shared packages compile to `dist/`. The `dev:*`, `test` and `typecheck` scripts build them
first. After changing a package while a dev server is running, run `npm run build:packages`.

### Common commands

| Command | What it does |
|---|---|
| `npm test` | Unit and integration tests in all workspaces. API tests start an in-memory MongoDB replica set; the first run downloads a MongoDB binary. |
| `npm run typecheck` | Strict TypeScript across all workspaces |
| `npm run build` | Builds the packages, API and web |
| `docker compose up -d --build` | Full stack. Needs `JWT_ACCESS_SECRET` in a root `.env` (see `.env.example`). |

### Dependency notes

- **TypeScript is pinned to 6.0.x.** TS 7 (the native Go port) is npm `latest`, but Next.js and
  Expo tooling still rely on the JS compiler API. Expo SDK 58 also pins `~6.0.3`.
- **Two Tailwind versions coexist.** Web uses Tailwind 4. Mobile uses Tailwind **3.4**, because
  NativeWind 4 (`react-native-css-interop`) requires `tailwindcss ~3`. npm puts v3 at the root
  and nests v4 under `apps/web`.
- **Add mobile packages from the repo root**, then re-check the tree:
  ```bash
  cd apps/mobile && npx expo install <pkg> && cd ../.. && npm install && npm ls tailwindcss
  ```
  Running `expo install` inside the workspace once produced an invalid hoisted tree. A root
  `npm install` repairs it.
- npm 11 asks before running install scripts. None are needed:
  - esbuild ships its binary as an optional dependency.
  - mongodb-memory-server downloads lazily.
  - `@scarf/scarf` is telemetry.

## Phase status

### Phase 3: Core administration

Verified on 2026-11-11. Totals: 121 automated tests (API 81, shared packages 40), plus a
23-check end-to-end run against the compiled API and the production web build.

| Item | Status | Evidence |
|---|---|---|
| Organisations CRUD (platform admin), unique immutable codes, guarded deactivation | ✅ | `administration.test.ts` + e2e |
| Facilities and communities CRUD, organisation pinned by scope, per-org uniqueness, deactivation refused while staff or CHWs are assigned | ✅ | Tests + e2e |
| CHW profiles (programme areas, referral authorisation, supervisor, device-sync fields) created atomically with the account; backfill for older accounts | ✅ | Tests + e2e |
| Programme settings (pilot targets unset until saved, operational thresholds), optimistic concurrency | ✅ | Tests + e2e |
| Audit-log viewer (scoped, filters, actor names) and CHW activity history | ✅ | Tests + e2e |
| Analytics overview: real counts vs. pilot targets, no personal data | ✅ | Tests + e2e |
| **Scope bug found and fixed**: id lookups could be overridden by `_id`-keyed scope filters | ✅ | `scope-isolation.test.ts`; decisions A23 |
| Web: Organisations, Facilities, Communities, Health workers (list + detail), Programme settings, Audit log, dashboard figures, grouped sidebar, organisation switcher for platform admins | ✅ build | `next build` (CHW detail partially prerendered), typecheck and lint clean; all pages served 200 |
| Web screens clicked through in a real browser | ⬜ not yet verified | No browser automation was available in this environment |

### Phase 2: Authentication & access control

Verified on 2026-11-11. Totals: 101 automated tests (API 61, shared packages 40), plus a
24-check end-to-end run against the compiled API and the production web build.

| Item | Status | Evidence |
|---|---|---|
| Argon2id hashing (`@node-rs/argon2`, prebuilt binaries incl. Alpine/musl, no install script) | ✅ | Hash format checked in DB; login tests |
| Login with generic errors, timing equalisation, lockout (5 attempts / 15 min, configurable) | ✅ | `auth.test.ts` |
| 15-min access JWT; user re-loaded per request so deactivation and revocation apply immediately | ✅ | Tests + e2e: deactivated CHW locked out at once |
| Rotating refresh tokens: web httpOnly `SameSite=Strict` cookie, mobile body token, 30 s retry grace, family revocation on reuse | ✅ | Rotation, grace, reuse, expiry and cookie tests |
| Logout, logout of all devices, change password (other devices signed out), forgot/reset password, account activation | ✅ | Tests + e2e |
| RBAC from `ROLE_PERMISSIONS` and access scopes (platform / organisation / facility / CHW) enforced in repositories | ✅ | `users.test.ts`, `directory.test.ts`: cross-org reads 404, explicit filters can't widen scope |
| User management: create (role matrix), update (optimistic concurrency), activate/deactivate, password links | ✅ | Escalation, cross-org, duplicate and version-conflict tests |
| Append-only audit log (logins, failures, lockouts, reuse, user changes) with no PII in metadata | ✅ | Tests assert no email/phone in audit records |
| `create-admin` bootstrap script; `seed:dev` demo data (refuses in production) | ✅ | Run against a live replica set |
| OpenAPI for auth/users, request bodies generated from the shared Zod schemas | ✅ | `app.test.ts` |
| Web: sign-in, forgot/reset/activate, protected shell (collapsible sidebar, mobile sheet, breadcrumbs, user menu), dashboard, Users, My profile | ✅ build | `next build`, typegen + `tsc`, eslint clean; pages served 200; API flow verified e2e |
| Web screens clicked through in a real browser | ⬜ not yet verified | No browser automation was available in this environment |
| Web/mobile Hausa translation layer | ⬜ deferred | Planned with the mobile app (Phase 7). See decisions A20. |

### Phase 1: Foundation

Verified on Windows 11, Node 26.8, on 2026-11-11.

| Item | Status | Evidence |
|---|---|---|
| Monorepo (npm workspaces), strict TS base config | ✅ | `npm run typecheck` passes in every workspace |
| Shared packages: roles/permissions, referral & follow-up state machines, referral codes with check symbol, API envelope types, Zod primitives (Nigerian phone, ObjectId, pagination), typed API client | ✅ | 40 unit tests (shared-types 19, validation 15, api-client 6) |
| API: env validation, pino logging with PII redaction, request IDs, helmet, CORS allowlist, rate limiting, JSON size limit, uniform error envelope, 404 handling, health/readiness, OpenAPI + Swagger UI, graceful shutdown | ✅ | 25 API tests |
| MongoDB connection: retry with backoff, credentials never logged, fails fast without transaction support | ✅ | Tests against an in-memory replica set (incl. transaction rollback) and a standalone instance |
| Production API build boots against a replica set | ✅ | `node dist/server.js` → `/health/ready` 200, database up |
| Web: Next.js 16 + Tailwind 4 design tokens, TanStack Query, live API status page, security headers, standalone output | ✅ | `next build`, typegen + `tsc`, eslint clean; standalone server served the page |
| Mobile: Expo SDK 58 + Expo Router + NativeWind 4, connectivity hook, API status screen | ✅ (bundle) | `tsc` clean; `expo export --platform android` bundles with compiled NativeWind styles; `expo install --check` OK |
| Mobile on a real Android device | ⬜ not yet verified | No device or emulator was available |
| Docker images and compose stack | 🟡 written, not run | Docker is not installed on the dev machine. The API image's npm ci, build, prod-install and boot steps were replayed locally and work. |
| `expo-doctor` | ⬜ | The npx-downloaded expo-doctor crashed (`Cannot find module '@expo/env'`), a tooling issue. `expo install --check` passed. |

Next: **Phase 4 — Patients** (registration, households, consent, profiles, search,
duplicate detection). See [docs/roadmap.md](docs/roadmap.md).
