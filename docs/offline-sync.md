# CARETRAIL — Offline Sync (as built in Phases 7–8)

This describes the implementation. Where it differs from the Phase 0 design, the reason is in
`decisions.md` (A36–A40).

## Pieces

| Piece | Where | Role |
|---|---|---|
| Sync engine | `packages/sync-core` (pure TypeScript, no React Native) | Push/pull loop, batching, dependency order, backoff, result mapping. Tested in Node with `MemoryStore` and against the real API (`apps/api/test/sync.test.ts`). |
| `LocalStore` on SQLite | `apps/mobile/database/sqlite-store.ts` | The engine's persistence on the phone. |
| Local data + offline writes | `apps/mobile/database/{db,repo}.ts` | Encrypted database, reads for screens, writes that insert the record and its outbox row in one transaction. |
| Triggers | `apps/mobile/services/sync.ts` | Connectivity regained (`expo-network`), app foreground, every 5 minutes while open, 3 s after any local write, and "Sync now". Runs are coalesced: never two at once. |
| Server | `apps/api/src/modules/sync` | `POST /sync/push`, `GET /sync/pull`, `GET /sync/status`, idempotency ledger `sync_operations`. |

## Device storage

- `expo-sqlite` with SQLCipher (`["expo-sqlite", { "useSQLCipher": true }]` in `app.json`). The
  key is 32 random bytes generated on first launch, kept in `expo-secure-store`, and applied with
  `PRAGMA key` before any other statement.
- Sign-out deletes the database file and the key. Before sign-out the app shows how many records
  are unsynced and will be lost.
- Tables hold the CHW's working set only: `patients`, `visits`, `referrals`, `appointments`,
  `follow_ups`, `households`, plus read-only `facilities`, `communities`, approved `templates`,
  and `outbox`, `drafts`, `kv` (cursor, settings, flags). Each row stores the API's DTO as JSON
  with a few indexed columns; `pending = 1` marks a record changed on the phone and not yet confirmed.
- A record created offline has the id `local:<clientId>` until the server answers; then it is
  replaced by the server id, and references to it (visits, referrals… of that patient) are
  rewritten in the same transaction.

## Outbox

| Column | Meaning |
|---|---|
| `op_id` | UUID from the device; the server's idempotency key |
| `op_type` | `patient.register`, `patient.update`, `visit.create`, `referral.create`, `appointment.create`, `followup.attempt`, `followup.resolve` (`consent.record`, `followup.create` are accepted by the server; the phone does not create them yet) |
| `entity_local_id` | `clientId` of the record it creates, or the id of the record it changes |
| `target_id` | for updates: server id or `local:<clientId>` |
| `payload` | validated with the shared Zod schema **before** it is queued, so invalid data never enters the outbox |
| `depends_on` | `op_id` that must be synced first (e.g. a visit for a patient registered offline) |
| `status` | `pending` · `syncing` · `synced` · `failed` · `conflict` |
| `retry_count`, `next_attempt_at`, `permanent`, `last_error`, `conflict` | retry and review state |

## Push — `POST /sync/push`

Body: `{ deviceId, operations: [{ opId, opType, targetId?, payload, createdAt }] }`, 1–25 ops.
The engine sends due ops in creation order and never one whose `depends_on` is unsynced.

For each op the server:

1. Claims `opId` in `sync_operations`. If it was already finished, the stored result is
   returned unchanged (safe replays after timeouts or crashes). A claim older than the stale
   limit is taken over; a fresh one answers `retry / IN_PROGRESS`.
2. Resolves `local:<clientId>` references to server ids through the `clientId` unique indexes.
   If the referenced record does not exist yet: `retry / DEPENDENCY_PENDING`.
3. Calls the same service method the online API uses, so validation, permission, scope, consent
   and audit rules are identical online and offline.
4. Stores and returns one result:

| Result | Meaning on the phone |
|---|---|
| `applied` (+ `serverId`, entity) | Local record replaced by the server's version (patient code, referral code…). |
| `rejected` (+ error) | Validation or permission failure. Marked `permanent`; never retried automatically; shown on the Sync screen. |
| `conflict` (`VERSION_CONFLICT` + current record, or `POSSIBLE_DUPLICATE` + candidates) | Shown on the Sync screen for a decision. |
| `retry` | Temporary problem; backoff applies. |

Network failures and 5xx responses mark the batch `failed` with backoff
`15 s × 2^(n−1)`, capped at 30 minutes, ±20 % jitter. A 401 stops the run and asks for the
session to be refreshed (`AuthRequiredError`). Ops left `syncing` by a crash are reset to
`pending` at the next start; the ledger makes the replay harmless.

## Pull — `GET /sync/pull?since=<cursor>`

Returns everything in the CHW's scope changed since the cursor: their assigned patients and those
patients' visits, referrals, appointments and follow-ups; their communities, households and the
organisation's active facilities; approved instruction templates; the programme's sync settings;
`canIssueReferrals`; `assignedPatientIds`; and a new cursor.

- The cursor is the server time of the pull minus a **5-second overlap**, so writes committing
  during the query are not missed; re-applying a record is harmless (upsert by id).
- The phone applies the whole response and the new cursor in **one SQLite transaction**.
- Records whose patient is no longer in `assignedPatientIds` (reassigned, deactivated) are purged.
- A patient or follow-up with an unsent change (an outbox op targeting it) is not overwritten by
  the pull, so the CHW keeps seeing their change. After the op is applied, the server's
  `updatedAt` is past the cursor and the next pull brings the server version. While the op is in
  conflict or rejected, the local version stays until the CHW resolves it on the Sync screen.

## Conflicts — what the CHW can do (Sync screen)

| Situation | Choices |
|---|---|
| Registration flagged as possible duplicate | **It's a different person — register** (re-queued with `confirmNotDuplicate: true` under a new `opId`, because the old one's answer is stored on the server), or **Discard**. |
| Someone changed the record first (`VERSION_CONFLICT`) | **Apply my change again** on the server's latest version, or **Discard** (local record returns to the server version on the next pull). |
| Rejected | **Try again** (e.g. after an admin fixes permissions) or **Discard**. |

Discarding removes the provisional record and every queued op that depends on it, and resets the
pull cursor so edited records come back from the server. Nothing is overwritten silently.

## Offline sign-in

The first sign-in needs the internet. The CHW then sets a 4–6 digit PIN (stored as a salted
hash in SecureStore). The app opens with the PIN while offline for `offlineSessionGraceDays`
(programme setting) after the last successful online contact; 5 wrong PINs wipe the session and
require an online sign-in. The app locks after 5 minutes in the background.

## Verified vs not verified

- **Verified here:** engine unit tests (9); API sync tests with the real engine over HTTP (5:
  offline → online, replay without duplicates, dependency chains, conflicts, rejections, purge
  after reassignment); mobile TypeScript check; Android JS bundle (`expo export --platform android`).
- **Not verified here:** running on a phone or emulator (SQLCipher native build, SecureStore,
  network listener, UI). This needs a development build (`eas build --profile development`) on a
  real device — ideally a low-end 2 GB RAM Android, as the risk register requires.
