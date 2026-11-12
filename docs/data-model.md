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

### chws (CHW programme profiles) ✅ Phase 3
`userId (unique), organisationId, programmeAreas[], canIssueReferrals: bool, supervisorUserId?,
device{lastSyncAt, appVersion, pendingOperations}, version`.
Identity, account status and **community assignment stay on the user** (`users.communityIds`),
because they drive authentication and data scope. A profile is created in the same transaction
as every `chw` user. Accounts that predate profiles get a default one on first read.

### programme_settings ✅ Phase 3
`organisationId (unique), pilot{communities, facilities, chws, patients, durationWeeks,
startDate}, referralExpectedArrivalDays, appointmentOverdueGraceDays, offlineSessionGraceDays,
updatedBy, version`. Absent until first saved; the API then reports defaults with
`configured: false`.

### households (SD) ✅ Phase 4
`organisationId, communityId, householdCode (HH-NNNNNN, unique per org), clientId?, headName?,
landmark? (directions, no GPS), phone?, createdBy, version`. Indexes: `{organisationId,
householdCode}` unique; `{organisationId, clientId}` unique partial; `{organisationId, communityId}`.

### patients (SD) ✅ Phase 4
| Field | Notes |
|---|---|
| patientCode | `CT-P-000123`, unique per org, from `counters` |
| clientId | device UUID; unique partial index `{organisationId, clientId}` → idempotent registration |
| organisationId, communityId, householdId? | |
| assignedChwId | the responsible CHW (user); drives CHW scope |
| fullName, nameKey | `nameKey` = shared `nameKey()` (case, accent, punctuation and word-order insensitive) |
| sex, dateOfBirth (YYYY-MM-DD) **or** estimatedBirthYear, birthYear | exactly one of DOB/estimate; `birthYear` is derived and indexed |
| phone?, alternatePhone?, phoneOwner (`self`/`household`/`none`) | E.164 |
| carePathway, pathwayDetails `{expectedDeliveryDate, deliveryDate, motherPatientId}` | coordination dates only; only the fields relevant to the pathway are kept |
| status, statusReason | the reason is free text on the record, never copied to the audit log |
| preferredLanguage, preferredChannel (`sms`/`voice`/`none`) | a channel requires matching consent and a phone |
| consent | summary of the latest consent record, per purpose `{granted, recordedAt}` |
| possibleDuplicateOf[] | set when registered despite a duplicate warning, for review |
Indexes: `{organisationId, patientCode}` unique; `{organisationId, clientId}` unique partial;
`{organisationId, assignedChwId, status}`; `{organisationId, communityId, status}`;
`{organisationId, nameKey, birthYear}` (duplicate detection); `{organisationId, phone}`;
`{householdId}`.

### consent_records (append-only) ✅ Phase 4
`organisationId, patientId, purposes {care_coordination, sms, voice, facility_sharing: bool},
method (verbal|thumbprint|signature), consentTextVersion, language, witnessName?, recordedBy,
recordedAt, clientId?`. Every record states every purpose. Updates and deletes are blocked at
the model level.

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
| issuedAt, expectedArrivalBy (YYYY-MM-DD) | expected date from programme settings |
| reason | free text by an authorised worker; shown to the facility, **not** printed on the receipt, never in audit logs |
| instructions[] | snapshot `{templateId, title, body, bodyHa, templateVersion}` of approved templates at issue time |
| priority | `null` / `routine` / `urgent`, settable only with `referral:set-priority` (facility staff) |
| status | see the state machine in `packages/shared-types/src/referral.ts` |
| arrival `{at, by}`, service `{at, by, summary}`, completion `{at, by}`, followUpNote, cancellation `{at, by, reason}` | |
| version | optimistic concurrency |
Indexes: `{referralCode}` unique; `{organisationId, clientId}` unique partial;
`{toFacilityId, status, expectedArrivalBy}`; `{organisationId, status, issuedAt}`;
`{patientId, issuedAt}`; `{issuedBy, issuedAt}`. ✅ Phase 5

### referral_events (append-only) ✅ Phase 5
`organisationId, referralId, patientId, kind (status|priority), fromStatus, toStatus, priority,
actorId, actorRole, facilityId, at, note, source (web|mobile|system)`. Indexes `{referralId, at}`,
`{patientId, at}`. Updates and deletes are blocked at the model level. Feeds the referral and
patient timelines.

### referral_instruction_templates ✅ Phase 5
`organisationId, title, body, bodyHa, status (draft|approved|retired), approval {reviewerName,
reviewerCredentials, approvedOn, recordedBy}, createdBy, updatedBy, version`. Starts empty.

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

### settings (later phases)
Retention periods and escalation contacts will be added to `programme_settings` once agreed with
the programme (decisions A5, A11).

### counters
`{_id: '<org>:patientCode' | 'syncSeq', seq}` — atomic `$inc` for human IDs and sync sequence.
