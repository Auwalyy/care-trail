# CARETRAIL — Offline Sync Protocol

## Device storage

* `expo-sqlite` with SQLCipher enabled (`useSQLCipher` config plugin); the database key is a random
  256-bit key generated on first launch and kept in `expo-secure-store`
  (Android Keystore-backed). Logging out or a remote wipe deletes the key → data unreadable.
* Local tables mirror the CHW working set: `patients`, `households`, `visits`, `referrals`,
  `appointments`, `follow_up_tasks`, `facilities` (read-only), `education` (read-only),
  plus `outbox`, `sync_state`, `drafts`.
* Each local row has `local_id` (UUID v7), `server_id` (nullable until synced), `version`,
  `sync_status` (`synced` | `pending` | `conflict`).

## Outbox

| Column | Meaning |
|---|---|
| op_id | UUID v7 — also the **idempotency key** |
| entity_type, entity_local_id | |
| op_type | `patient.create`, `patient.update`, `consent.record`, `visit.create`, `referral.create`, `appointment.create`, `appointment.attendance`, `followup.create`, `followup.attempt`, … |
| payload | JSON (validated with the shared Zod schema before insert) |
| base_version | server version the edit was based on (updates only) |
| depends_on | op_id this op needs first (e.g. referral for an offline-created patient) |
| status | `pending` / `syncing` / `synced` / `failed` / `conflict` |
| retry_count, next_attempt_at, last_error | |
| created_at | |

A domain write and its outbox row are inserted in **one SQLite transaction**.

## Push

`POST /sync/push`
```json
{ "deviceId": "...", "operations": [
  { "opId": "0193…", "opType": "patient.create", "entityLocalId": "0193…",
    "baseVersion": null, "payload": { … }, "createdAt": "…",
    "refs": { "patientLocalId": "…" } } ] }
```
* Batches of ≤ 25 ops, ordered by `created_at`, never sending an op whose `depends_on` is unsynced.
* Server, per op: (1) look up `sync_operations` by `opId` — if found, return the stored result
  (retry-safe); (2) validate payload with shared Zod schema; (3) check permission + scope;
  (4) resolve `refs` local IDs → server IDs via `clientId` lookups; (5) apply in a transaction
  together with the `sync_operations` ledger insert; (6) return:

```json
{ "results": [ { "opId": "…", "status": "applied", "serverId": "…", "version": 1,
                 "serverFields": { "patientCode": "CT-P-000123" } },
               { "opId": "…", "status": "conflict", "server": { … } },
               { "opId": "…", "status": "rejected", "error": { "code": "FORBIDDEN" } } ] }
```

## Pull

`GET /sync/pull?cursor=<syncSeq>&limit=500` → `{ changes: { patients: [...], ... },
removed: [{entityType, id}], cursor, hasMore }`. Only scope-visible documents are returned;
patients reassigned away from the CHW appear in `removed` and are purged locally.
The client applies a page in one SQLite transaction and saves the cursor in the same transaction
→ restart-safe.

## Conflict policy by entity

| Entity / field | Policy |
|---|---|
| Visit notes, follow-up attempts | Append-only → never conflict |
| Patient contact fields (phone, landmark) | Field-level merge if the server field didn't change since `baseVersion`; else conflict |
| Patient identity (name, DOB, pathway) | Conflict → explicit review screen (keep mine / keep server) |
| Consent | Append-only records; latest by `recordedAt` wins for summary, both kept |
| Referral status | Server authoritative; client sends transition requests; invalid → rejected, local state replaced by server |
| Appointment attendance | First recorded attendance wins; later conflicting record → conflict review |

Nothing is silently overwritten: every conflict produces an outbox `conflict` row visible on the
Sync screen.

## Retry

Network/5xx errors → `failed` with `next_attempt_at = now + min(2^n × 15s, 30 min) ± jitter`.
4xx validation/permission → `failed` permanently (needs user action), shown on the Sync screen.
Sync triggers: app foreground, connectivity regained (`expo-network`), after each local write
(debounced), manual "Sync now", and a background fetch task where the OS allows.
Ops stuck in `syncing` at app start (crash mid-sync) are reset to `pending` — safe because the
server ledger makes replays idempotent.
