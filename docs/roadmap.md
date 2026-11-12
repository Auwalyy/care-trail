# CARETRAIL — Roadmap & Status

Status legend: ✅ done and tested · 🟡 in progress · ⬜ not started

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture, data model, API contracts, navigation, risks | ✅ (docs/) |
| 1 | Foundation: monorepo, TS config, API skeleton, MongoDB connection, logging, error handling, env config, shared packages, Next.js + Expo setup | ✅ code and tests. Real-device run and Docker run still pending (see README). |
| 2 | Auth & access control: users, Argon2id, JWT + rotating refresh, RBAC, scopes, protected routes (API + web) | ✅ API tests and live end-to-end run. Web UI not clicked through in a browser. |
| 3 | Core admin: organisations, facilities, communities, CHW profiles, programme settings, audit viewer, dashboard figures | ✅ API tests and live end-to-end run. Web UI not clicked through in a browser. Per-CHW patient and task counts move to Phases 4 and 6. |
| 4 | Patients: registration, households, consent, profiles, search, duplicate detection | ✅ API tests and live end-to-end run (incl. log scan). Web UI not clicked through in a browser. |
| 5 | Referrals: creation, codes, receipts, verification, transitions, history | ✅ API tests and live end-to-end run (incl. log scan). Web UI not clicked through in a browser. |
| 6 | Appointments & follow-up: scheduling, attendance, missed-care job, tasks, escalation | ✅ API tests and live end-to-end run (scheduler observed). Web UI not clicked through in a browser. |
| 7 | Mobile app: auth, dashboard, patients, visits, referrals, appointments, profile, i18n | ⬜ next (built together with Phase 8) |
| 8 | Offline engine: SQLite/SQLCipher, outbox, push/pull, idempotency, conflicts, retries, sync UI | ⬜ |
| 9 | Education CMS & notifications (SMS/voice/push/in-app abstraction) | ⬜ |
| 10 | Analytics & exports | ⬜ |
| 11 | QA: security, performance, offline, E2E | ⬜ |
| 12 | Deployment: Docker, backups, monitoring, EAS Android build | ⬜ |

## Status details

See the README "Phase status" section for what has been verified and how.

## Phase 6 plan (next): appointments and missed-care recovery

Decisions needed from the programme (defaults in brackets):

- **Appointment schedules** [none are built in. Appointments are created one at a time by CHWs or
  facility staff. Schedule templates (e.g. an antenatal contact plan) can be added later as
  admin-configured, clinically approved templates, like referral instructions].
- **Escalation contacts** [a task can be escalated to the CHW's supervisor, or to programme
  admins if no supervisor is set. Escalation records the notes and notifies; it never makes a
  clinical decision].
- **How often the missed-care job runs** [every 15 minutes, with a manual "Run now" for admins.
  It uses the server's clock, never the device's].

Work items:

1. `appointments`: create (category, facility, date), reschedule, cancel with a reason, record
   attendance. CHWs work on their own patients; facility staff on appointments at their facility,
   which also gives them a minimal view of those patients, as referrals do.
2. `follow_up_tasks` with the shared task state machine (`FOLLOW_UP_TRANSITIONS`): contact
   attempts (method, reached, response), outcome, next action, resolve and escalate.
3. **Missed-care job.** It is idempotent: a unique open-task index on (source, reason) stops
   duplicates. It finds:
   - appointments past date + grace without attendance (→ `missed` + task);
   - referrals awaiting arrival past `expectedArrivalBy` (→ `expired` system event + task);
   - referrals stuck in `follow_up_required` (→ task);
   - overdue tasks.

   Tasks go to the patient's current CHW. The job runs in-process in development and as a
   BullMQ repeatable job when `REDIS_URL` is set.
4. Dashboard and analytics: missed appointments, overdue follow-ups, and the follow-up success
   rate.
5. Web: appointment lists (facility day view, patient tab), a follow-up task board (programme
   view), the task detail with contact attempts, and a "Run missed-care check" button for admins.
6. Tests: the job is idempotent when run twice, plus grace periods, server-time handling, the task
   transition matrix, escalation routing, and scope for tasks and appointments.
