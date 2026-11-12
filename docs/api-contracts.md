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

**Auth**: `Authorization: Bearer <accessToken>` (HS256 JWT, 15 min, claims `sub`, `role`, `sv`
session version, `cl` client). Every request re-loads the user, so deactivation or a
session-version bump takes effect immediately. Web uses an httpOnly, `SameSite=Strict` refresh
cookie (`ct_rt`, path `/api/v1/auth`, `Secure` in production); mobile sends the refresh token in
the body and stores it in SecureStore. Refresh tokens rotate on every use; a rotated token
re-presented within 30 s is treated as a lost-response retry, after that as theft (the whole token
family is revoked and audited). Sign-in locks for 15 min after 5 failures (configurable).

Because the refresh cookie is `SameSite=Strict`, **the web app and API must share a registrable
domain in production** (e.g. `app.caretrail.example` and `api.caretrail.example`).

## Endpoints and permissions

| Method & path | Permission | Notes |
|---|---|---|
| POST /auth/login | public (rate-limited) | → `{accessToken, refreshToken?, user}` |
| POST /auth/refresh | refresh token | rotates; reuse revokes family |
| POST /auth/logout | authenticated | revokes current family |
| POST /auth/forgot-password | public (rate-limited) | always 202 (no account enumeration) |
| POST /auth/reset-password | reset token | revokes all sessions |
| GET /auth/me | authenticated | |
| POST /auth/change-password | authenticated | returns a fresh session for this device; all other sessions revoked |
| GET /users, /users/:id | `user:read` | ✅ scoped: platform → all; programme admin → own org; facility admin → own facility |
| POST /users | `user:manage` | ✅ role matrix `MANAGEABLE_ROLES`; returns user + one-time activation link; no admin-set passwords |
| PATCH /users/:id | `user:manage` | ✅ name, phone, language, facility/community reassignment; `version` required |
| POST /users/:id/status | `user:manage` | ✅ `{status: active\|inactive, version}`; deactivation revokes all sessions immediately |
| POST /users/:id/password-link | `user:manage` | ✅ new activation link (pending users) or 24 h reset link (active users) |
| GET /organisations, /organisations/:id | `organisation:read` | ✅ platform → all; others → own organisation only |
| POST /organisations, PATCH /organisations/:id | `organisation:manage` | ✅ platform admin; code unique and immutable; deactivation refused while user accounts exist |
| GET/POST /facilities, GET/PATCH /facilities/:id | `facility:read` / `facility:manage` | ✅ organisation-scoped; platform admins pass `organisationId`; code unique per org; deactivation refused while staff are assigned |
| GET/POST /communities, GET/PATCH /communities/:id | `community:read` / `community:manage` | ✅ unique (org, LGA, name); deactivation refused while CHWs are assigned |
| GET/POST /chws, GET/PATCH /chws/:id | `chw:read` / `chw:manage` | ✅ `:id` is the CHW's user id; POST creates account + profile atomically and returns an activation link; PATCH edits profile (communities, programme areas, `canIssueReferrals`, supervisor). Account status/links via `/users`. |
| GET /settings, PUT /settings | `settings:manage` | ✅ per organisation (`?organisationId=` for platform admins); `configured:false` with defaults until first save; PUT with `version` (0 = first save) |
| GET /analytics/overview | `analytics:read` | ✅ aggregate counts (facilities, communities, CHWs by status, staff) + pilot targets; no personal data |
| POST /patients | `patient:create` + `consent:record` | ✅ One transaction: patient (`CT-P-NNNNNN`), optional new household, consent record, audit. `clientId` makes it idempotent (a repeat returns 200 with `alreadyRegistered: true`). A likely duplicate returns `409 POSSIBLE_DUPLICATE` with minimal `candidates` unless `confirmNotDuplicate: true`, in which case the record is flagged (`possibleDuplicateOf`). Care-coordination consent is required. CHWs are always assigned to themselves; admins must choose a CHW who serves the community. |
| GET /patients | `patient:read` | ✅ scoped (platform all · programme admin own org · CHW own caseload · facility staff none yet); filters `q` (name / code prefix / phone), `communityId`, `assignedChwId`, `carePathway`, `status`, `possibleDuplicate=true` |
| GET /patients/:id | `patient:read` | ✅ every read is audited (`patient.view`); `Cache-Control: no-store` on all patient responses |
| PATCH /patients/:id | `patient:update` | ✅ `version` required; pathway rules re-checked on the merged record; changing community requires the assigned CHW to serve it |
| POST /patients/:id/status | `patient:update` | ✅ reason required unless `active`; reactivation requires care-coordination consent; the reason stays on the record, not in the audit log |
| POST /patients/:id/reassign | `patient:reassign` | ✅ programme staff only; the new CHW must serve the patient's community |
| GET / POST /patients/:id/consent | `consent:read` / `consent:record` | ✅ append-only records stating every purpose; withdrawing care coordination sets the patient `inactive`; withdrawing SMS/voice resets the reminder channel |
| GET /patients/:id/history | `patient:read` | ✅ timeline (registration, updates, status, reassignment, consent); referrals, appointments and follow-ups join in Phases 5–6 |
| GET/POST /households, GET/PATCH /households/:id | `patient:read` / `household:manage` | ✅ `HH-NNNNNN`; CHWs limited to their communities; `GET /:id` lists members filtered by the caller's patient scope |
| POST/GET /visits | `visit:create` / `visit:read` | ✅ CHW home visits: `{patientId, visitDate, outcome, followUpRequired, nextActivityDate?, notes?, clientId?}`. Visit date not in the future; `clientId` idempotent. Scope as patients. Notes are not audited. |
| POST /referrals | `referral:create` (+ CHW `canIssueReferrals`) | ✅ Requires the patient to be in scope and active, facility-sharing consent, an active receiving facility in the organisation, and **approved** instruction templates only. Instructions are snapshotted. `expectedArrivalBy` = today + `referralExpectedArrivalDays`. Server-generated `CT-XXXX-XXXX` (retried on collision). `clientId` idempotent (repeat → 200 `alreadyIssued`). |
| GET /referrals | `referral:read` | ✅ Scope: platform all · programme admin own org · facility staff referrals **to** their facility · CHW referrals they issued or for their current patients. Filters: `status` (comma list), `open`, `overdue`, `toFacilityId`, `patientId`, `q` (code prefix). |
| GET /referrals/:id, /referrals/:id/history | `referral:read` | ✅ Includes a minimal patient summary (no phone, household or consent) and `overdue` (awaiting arrival past `expectedArrivalBy`); history lists append-only events with actor, role, facility, source |
| GET /referrals/code/:code | `referral:verify` | ✅ Check symbol validated before lookup (typos → 400); O/I read as 0/1; 404 unless addressed to the caller's facility; audited |
| PATCH /referrals/:id/status | `referral:update-status` or `referral:cancel` | ✅ `{toStatus, version, note?, serviceSummary?}` through `checkReferralTransition` with the caller's role: 403 for wrong role, 422 `INVALID_TRANSITION` for an illegal step, 400 for a missing note or summary. Event and audit written in the same transaction. |
| PATCH /referrals/:id/priority | `referral:set-priority` | ✅ facility staff only; recorded as an event |
| GET/POST /referral-templates, GET/PATCH /referral-templates/:id, POST /:id/approve | `referral:read` / `referral:manage-templates` | ✅ Managers see all statuses; others see approved only. Approval records reviewer name, qualification and date. Editing approved wording returns it to draft. Retire with `status: retired`. |
| GET/POST /appointments, GET/PATCH /appointments/:id | `appointment:read` / `appointment:manage` | ✅ Scope: facility staff see their facility; CHWs their patients. Facility staff can book only for patients linked to their facility (via a referral or appointment). PATCH reschedules (`{scheduledFor, version}`); dates from today up to 1 year. `clientId` idempotent. |
| POST /appointments/:id/cancel | `appointment:manage` | ✅ reason required; resolves an open missed-appointment task |
| POST /appointments/:id/attendance | `appointment:record-attendance` | ✅ `{outcome: attended\|missed, version}`, facility staff only. Attending resolves the open missed-appointment task; marking missed creates one. |
| GET/POST /follow-ups, GET/PATCH /follow-ups/:id | `followup:read` / `followup:manage` | ✅ Scope: programme staff own org; CHWs their tasks (plus any escalated to them); facility staff only tasks escalated to them. Filters `open`, `overdue`, `status`, `reason`, `assignedChwId`, `patientId`. |
| POST /follow-ups/:id/attempts | `followup:manage` | ✅ `{method, reached, response?}`; reached → `contacted`; the response is never audited |
| POST /follow-ups/:id/resolve, /escalate | `followup:manage` / `followup:escalate` | ✅ outcome or notes required; escalation goes to the CHW's supervisor, else the organisation's programme admins |
| POST /follow-ups/missed-care/run | `settings:manage` | ✅ runs the missed-care check now (own org; platform admin all or `?organisationId`); returns counts |
| GET/POST /education, GET/PATCH /education/:id | `education:read` / `education:manage` | ✅ authors and reviewers see all statuses, others published only; Hausa title and text together or not at all; editing reviewed content returns it to draft |
| POST /education/:id/transition | `education:manage` (submit, publish, unpublish, archive) / `education:approve` (approve with reviewer name, qualification, date; return with note) | ✅ 422 for a step not allowed from the current status |
| PUT / DELETE / GET /education/:id/audio/:lang | `education:manage` / `education:read` | ✅ raw file body with `?version=`; MP3, M4A, AAC, OGG, WAV, WebM up to 10 MB, signature checked |
| GET /notifications/inbox, /inbox/count, POST /inbox/:id/read, /inbox/read-all | authenticated | ✅ own in-app messages only; `?lang=ha` renders Hausa |
| POST /notifications/send | `notification:send` | ✅ `{appointmentId}` or `{referralId}` in scope; text built from the template; one manual reminder per record per day; uses the patient's preferred channel; blocked without consent |
| GET /notifications/history | `notification:send` | ✅ SMS/voice history for the organisation with status and reason; never phone numbers or text |
| POST /notifications/dispatch/run | `settings:manage` | ✅ plans reminders and sends what is due now |
| GET /analytics/report | `analytics:read` | ✅ `report` = monthly · referrals · appointments · communities · chws · followups; `from`, `to` (default last 90 days, max 2 years), `organisationId` (platform admins, required), `facilityId`, `communityId`, `format=json` or `format=csv`. Columns, rows and totals; counts only. CSV downloads are audited. |
| POST /sync/push | `sync:use` | ✅ 1–25 ops; per-op result `applied` / `rejected` / `conflict` / `retry`; idempotent by `opId` (ledger). See offline-sync.md. |
| GET /sync/pull?since= | `sync:use` | ✅ CHW working set changed since `since` (ISO), plus `assignedPatientIds`, settings, `canIssueReferrals` and the next cursor |
| GET /sync/status | `sync:use` | ✅ server time and the caller's ledger counts |
| GET /audit-logs | `audit:read` | ✅ scoped; filters `action` (prefix), `outcome`, `entityType`, `entityId`, `actorId`, `from`, `to`; actor names resolved |
| GET /health, /health/ready | public | liveness / readiness (DB ping) |

The canonical role → permission map lives in `packages/shared-types/src/permissions.ts`.
