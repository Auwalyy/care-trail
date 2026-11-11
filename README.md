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

npm run dev:api      # http://localhost:4000  (Swagger UI: /api/docs)
npm run dev:web      # http://localhost:3000
npm run dev:mobile   # Expo dev server
```

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

## Phase 1 status (Foundation)

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

Next: **Phase 2 — Authentication & access control.** See [docs/roadmap.md](docs/roadmap.md).
