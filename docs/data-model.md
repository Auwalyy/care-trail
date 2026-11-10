# CARETRAIL — Data Model (MongoDB)

Conventions for every collection:

* `_id: ObjectId` (server-authoritative). Documents created offline also keep `clientId`
  (UUID v7 from the device) with a unique sparse index `(organisationId, clientId)` — this is what
  makes sync retries idempotent at the data level.
* `organisationId` on every tenant-owned document (tenant boundary).
* `createdAt`, `updatedAt` (Mongoose timestamps), `createdBy`, `updatedBy`.
* `version: number` — incremented on every update; used for optimistic concurrency and sync
  conflict detection.
* `deletedAt` soft deletion where noted (SD). Queries exclude soft-deleted docs by default.
* `syncSeq: number` — monotonically increasing sequence (from a `counters` collection) stamped on
  every write of sync-visible collections; the mobile pull cursor is the last `syncSeq` seen.

## Relationship overview

```
organisations 1─* communities 1─* households 1─* patients
organisations 1─* facilities
organisations 1─* users (role, facilityId?, communityIds[])
users(chw) 1─1 chws (profile, assignments, flags)
patients *─1 chws (assignedChwId)
patients 1─* consent_records
patients 1─* visits          (chwId)
patients 1─* referrals       (issuedBy chw/user, fromFacility|fromCommunity, toFacility)
referrals 1─* referral_events
patients 1─* appointments    (facilityId, category)
follow_up_tasks *─1 patients, source → appointment | referral | visit | manual
education_contents (versions, translations en/ha, reviewer)
notifications *─1 patients|users
sync_operations (idempotency ledger per device)
audit_logs (append-only)
settings (programme / pilot configuration)
counters (sequences for human IDs and syncSeq)
refresh_tokens (session family, hashed)
```

## Collections

### users
| Field | Type | Notes |
|---|---|---|
| email | string | unique (lowercased) |
| phone | string? | E.164 |
| passwordHash | string | Argon2id |
| fullName | string | |
| role | enum | `platform_admin`, `programme_admin`, `facility_admin`, `facility_worker`, `chw` |
| organisationId | ObjectId? | null only for platform_admin |
| facilityId | ObjectId? | facility roles |
| communityIds | ObjectId[] | programme_admin (optional), chw |
| status | enum | `active`, `inactive`, `pending_activation` |
| preferredLanguage | `en` \| `ha` | |
| passwordChangedAt, lastLoginAt | Date | |
Indexes: `{email:1}` unique; `{organisationId:1, role:1, status:1}`.

### refresh_tokens
`userId, familyId, tokenHash, deviceId?, expiresAt, revokedAt?, replacedBy?` —
TTL index on `expiresAt`; `{tokenHash:1}` unique.

### organisations
`name, code (unique), status, contactEmail, state (e.g. "Kano"), lgas[]`.

### communities (SD)
`organisationId, name, lga, ward?, status`. Unique `{organisationId, name, lga}`.

### facilities (SD)
`organisationId, name, code (unique per org), type (PHC|general_hospital|other), lga, ward?,
address, phone?, status, servicesOffered[] (configured labels)`.

### chws
`userId (unique), organisationId, communityIds[], programmeAreas[], canIssueReferrals: bool,
supervisorUserId?, deviceInfo{lastSyncAt, appVersion, pendingOps}, status`.

### households (SD)
`organisationId, communityId, householdCode (human, unique per org), headName?, address/landmark,
phone?, clientId?`.

### patients (SD)
| Field | Notes |
|---|---|
| patientCode | `CT-P-000123` human ID, unique per org, server-generated |
| clientId | device UUID when created offline |
| organisationId, communityId, householdId? | |
| assignedChwId | ObjectId (user) |
| fullName, dateOfBirth? / estimatedAge? | DOB optional; age estimate allowed |
| sex | needed for newborn records |
| phone?, alternatePhone?, phoneOwner (`self`/`household`/`none`) | |
| carePathway | `antenatal`, `postnatal`, `newborn`, `caregiver` |
| pathwayDetails | `{ expectedDeliveryDate?, deliveryDate?, motherPatientId? }` — dates only, no clinical findings |
| status | `active`, `transferred`, `completed`, `inactive`, `deceased` |
| consentStatus | denormalised summary of latest consent |
| preferredLanguage, preferredChannel (`sms`/`voice`/`none`) | |
Indexes: `{organisationId, patientCode}` unique; `{organisationId, clientId}` unique sparse;
`{organisationId, assignedChwId, status}`; `{organisationId, communityId}`; text-ish search via
`{organisationId, nameNormalized}` + phone; duplicate-detection key
`{organisationId, nameNormalized, dateOfBirth|estimatedBirthYear, communityId}` (non-unique;
duplicates are flagged for review, not rejected).

### consent_records (append-only)
`patientId, organisationId, purposes[] (care_coordination, sms, voice, facility_sharing),
granted: bool, method (verbal|thumbprint|signature), consentTextVersion, language,
recordedBy (chw), witnessName?, recordedAt, clientId?, supersedes?`.

### visits
`patientId, chwId, organisationId, visitDate, outcome (enum: met, not_home, refused, moved,
other), followUpRequired, nextActivityDate?, notes (operational, length-limited), clientId,
version`.

### referrals
| Field | Notes |
|---|---|
| referralCode | `CT-XXXX-XXXX` unique, server-generated |
| clientId | device UUID |
| patientId, organisationId | |
| issuedBy | user id; `issuedByRole` |
| origin | `{ type: 'community' \| 'facility', communityId?, facilityId? }` |
| toFacilityId | |
| referralDate, expectedArrivalBy | |
| reason | free text by authorised worker |
| instructionTemplateIds[] | approved instruction templates (configured) |
| priority? | `routine`/`urgent` — only settable by roles with `referral:set-priority` |
| status | see state machine |
| arrival `{at, confirmedBy}`, service `{at, recordedBy, summary}`, completion `{at, by, outcome, notes}` | |
| version | optimistic concurrency |
Indexes: `{referralCode}` unique; `{organisationId, clientId}` unique sparse;
`{toFacilityId, status, expectedArrivalBy}`; `{patientId, createdAt}`; `{status, expectedArrivalBy}`.

### referral_events (append-only)
`referralId, organisationId, fromStatus, toStatus, actorId, actorRole, facilityId?, at, note?,
source ('web'|'mobile'|'system')`. Index `{referralId, at}`.

### appointments
`patientId, organisationId, facilityId, category (antenatal, postnatal, immunisation, preventive,
other), scheduledFor, status (scheduled, attended, missed, rescheduled, cancelled),
attendance{at, recordedBy}?, cancellation{reason, by, at}?, rescheduledFrom?, createdBy, clientId,
version`. Indexes `{organisationId, status, scheduledFor}`, `{patientId, scheduledFor}`,
`{facilityId, scheduledFor}`.

### follow_up_tasks
`organisationId, patientId, assignedChwId, source{type (appointment|referral|visit|manual), id},
reason (missed_appointment, referral_not_arrived, referral_incomplete, overdue_follow_up,
manual), status (pending, assigned, in_progress, contacted, resolved, escalated), dueAt,
attempts[{at, method (call|sms|visit), reached, response, by}], outcome?, nextAction?,
escalation{to, notes, at, by}?, clientId?, version`.
Unique partial index `{source.type, source.id, reason}` where status not in (resolved) — job
idempotency.

### education_contents
`category, slug, status (draft, in_review, approved, published, archived), version,
translations: { en: {title, body, audioKey?}, ha: {title, body, audioKey?} }, author,
clinicalReviewer {userId?, name, credentials}, approvedAt?, publishedAt?, previousVersionId?`.
Only `published` content with an approval record for the language being sent may be distributed.

### notifications
`organisationId, recipient {type: patient|user, id, phone?}, channel (sms|voice|push|in_app),
templateKey, params (non-clinical), language, status (queued, sending, sent, delivered, failed,
not_sent_no_provider, blocked_no_consent), attempts, lastError?, providerMessageId?, scheduledFor,
sentAt?, deliveredAt?`.

### sync_operations (idempotency ledger)
`idempotencyKey (unique), deviceId, userId, organisationId, opType, entityType, clientEntityId,
serverEntityId?, status (applied, rejected, conflict), result (stored response), receivedAt`.
TTL on `receivedAt` (90 days) after which retries are no longer possible — devices are forced to
re-sync well before.

### audit_logs (append-only)
`at, actorId, actorRole, organisationId?, action, entityType, entityId, requestId, ip?,
changes? (field names only for PII fields, never values)`. Index `{organisationId, at}`,
`{entityType, entityId}`.

### settings
Scope `platform` or per `organisationId`: pilot targets (communities, facilities, CHWs, patients,
durationWeeks, startDate), referral expected-arrival default (days), appointment overdue grace,
offline session grace period, retention periods, escalation contacts.

### counters
`{_id: '<org>:patientCode' | 'syncSeq', seq}` — atomic `$inc` for human IDs and sync sequence.
