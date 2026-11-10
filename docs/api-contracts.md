# CARETRAIL — API Contracts (v1)

Base path: `/api/v1`. JSON only. Interactive docs: `/api/docs` (OpenAPI 3.1).

## Conventions

**Success envelope**
```json
{ "data": { ... }, "meta": { "requestId": "..." } }
```
**List envelope**
```json
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 134, "totalPages": 7, "requestId": "..." } }
```
**Error envelope**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [{ "path": "phone", "message": "Invalid phone number" }] },
  "meta": { "requestId": "..." } }
```
Error codes: `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404,
`CONFLICT` 409, `VERSION_CONFLICT` 409, `INVALID_TRANSITION` 422, `RATE_LIMITED` 429,
`INTERNAL_ERROR` 500, `SERVICE_UNAVAILABLE` 503.

**Lists**: `?page=1&pageSize=20&sort=-createdAt&q=search` plus resource filters. `pageSize` ≤ 100.

**Concurrency**: mutable resources return `version`; `PATCH` bodies must include `version`.
Mismatch → `409 VERSION_CONFLICT` with the current server document in `error.details`.

**Auth**: `Authorization: Bearer <accessToken>`. Web uses an httpOnly, `SameSite=Strict`,
path-scoped refresh cookie; mobile sends the refresh token in the body and stores it in SecureStore.

## Endpoints and permissions

| Method & path | Permission | Notes |
|---|---|---|
| POST /auth/login | public (rate-limited) | → `{accessToken, refreshToken?, user}` |
| POST /auth/refresh | refresh token | rotates; reuse revokes family |
| POST /auth/logout | authenticated | revokes current family |
| POST /auth/forgot-password | public (rate-limited) | always 202 (no account enumeration) |
| POST /auth/reset-password | reset token | revokes all sessions |
| GET /auth/me | authenticated | |
| CRUD /users | `user:manage` | scoped: programme admins manage own org; facility admins manage own facility workers |
| CRUD /organisations | `organisation:manage` | platform admin |
| CRUD /communities | `community:manage` | |
| CRUD /facilities | `facility:manage` / `facility:read` | |
| POST/GET/PATCH /chws | `chw:manage` / `chw:read` | |
| POST /patients | `patient:create` | duplicate check → `409 POSSIBLE_DUPLICATE` with candidates unless `confirmNotDuplicate=true` |
| GET /patients, /patients/:id | `patient:read` | scope-filtered; profile reads audited |
| PATCH /patients/:id | `patient:update` | identity fields need `version` |
| GET /patients/:id/history | `patient:read` | merged timeline: visits, referrals, appointments, tasks, consent |
| POST /patients/:id/consent | `consent:record` | append-only |
| CRUD /households | `household:manage` | |
| POST/GET /visits | `visit:create` / `visit:read` | |
| POST /referrals | `referral:create` (+ CHW `canIssueReferrals`) | returns `referralCode` |
| GET /referrals, /referrals/:id | `referral:read` | facility roles see referrals to their facility |
| GET /referrals/code/:code | `referral:verify` | check-digit validated before lookup |
| PATCH /referrals/:id/status | `referral:update-status` | body `{toStatus, version, note?, serviceSummary?}`; transition and role validated against `REFERRAL_TRANSITIONS` |
| GET /referrals/:id/history | `referral:read` | |
| POST/GET/PATCH /appointments | `appointment:manage` / `appointment:read` | |
| POST /appointments/:id/attendance | `appointment:record-attendance` | |
| POST/GET/PATCH /follow-ups | `followup:manage` / `followup:read` | |
| POST /follow-ups/:id/attempts | `followup:manage` | contact attempt |
| POST /follow-ups/:id/resolve, /escalate | `followup:manage` | |
| CRUD /education | `education:manage`; `education:approve` for approval | |
| GET /notifications | authenticated | own in-app notifications |
| POST /notifications/send | `notification:send` | template-based only |
| GET /notifications/history | `notification:read` | |
| GET /analytics/overview, /referrals, /facilities, /communities | `analytics:read` | aggregated only; filters `from,to,facilityId,communityId,organisationId` |
| POST /sync/push | `sync:use` | see offline-sync.md |
| GET /sync/pull?cursor= | `sync:use` | |
| GET /sync/status | `sync:use` | |
| GET /audit-logs | `audit:read` | |
| GET/PATCH /settings | `settings:manage` | pilot configuration |
| GET /health, /health/ready | public | liveness / readiness (DB ping) |

The canonical role → permission map lives in `packages/shared-types/src/permissions.ts`.
