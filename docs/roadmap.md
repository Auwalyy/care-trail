# CARETRAIL — Roadmap & Status

Status legend: ✅ done and tested · 🟡 in progress · ⬜ not started

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture, data model, API contracts, navigation, risks | ✅ (docs/) |
| 1 | Foundation: monorepo, TS config, API skeleton, MongoDB connection, logging, error handling, env config, shared packages, Next.js + Expo setup | ✅ code and tests. Real-device run and Docker run still pending (see README). |
| 2 | Auth & access control: users, Argon2id, JWT + rotating refresh, RBAC, scopes, protected routes (API + web) | ✅ API tests and live end-to-end run. Web UI not clicked through in a browser. |
| 3 | Core admin: organisations, facilities, communities, CHW profiles, programme settings, audit viewer, dashboard figures | ✅ API tests and live end-to-end run. Web UI not clicked through in a browser. Per-CHW patient and task counts move to Phases 4 and 6. |
| 4 | Patients: registration, households, consent, profiles, search, duplicate detection | ⬜ next |
| 5 | Referrals: creation, codes, receipts, verification, transitions, history | ⬜ |
| 6 | Appointments & follow-up: scheduling, attendance, missed-care job, tasks, escalation | ⬜ |
| 7 | Mobile app: auth, dashboard, patients, visits, referrals, appointments, profile, i18n | ⬜ |
| 8 | Offline engine: SQLite/SQLCipher, outbox, push/pull, idempotency, conflicts, retries, sync UI | ⬜ |
| 9 | Education CMS & notifications (SMS/voice/push/in-app abstraction) | ⬜ |
| 10 | Analytics & exports | ⬜ |
| 11 | QA: security, performance, offline, E2E | ⬜ |
| 12 | Deployment: Docker, backups, monitoring, EAS Android build | ⬜ |

## Status details

See the README "Phase status" section for what has been verified and how.

## Phase 4 plan (next): patients

Open questions for the programme before or during this phase (defaults in brackets):

- **Minimum registration fields** [name, DOB or estimated age, community, care pathway, consent;
  phone optional].
- **Consent text wording and version** in English and Hausa. This must come from the programme,
  so CARETRAIL stores a version reference, not the text itself.
- **Duplicate-detection rule** [same organisation + normalised name + birth year ±1 + community
  → warn, never block].

Work items:

1. Shared Zod schemas for patient, household and consent (used by web now and mobile in Phase 7).
2. `counters` collection with server-generated `CT-P-NNNNNN` patient codes, plus the `clientId`
   idempotency index so offline registrations can't duplicate.
3. Households: create, update and list, scoped by community.
4. Patients: register in one transaction (patient, optional household, consent record, audit);
   search by name, code or phone; duplicate detection returns `409 POSSIBLE_DUPLICATE` with
   minimal candidate info; status changes; reassigning the CHW.
5. Consent: append-only records per purpose (care coordination, SMS, voice, facility sharing);
   the patient summary shows the latest per purpose.
6. Scope: CHWs see only patients assigned to them. Facility staff see none until referrals or
   appointments link a patient to their facility (Phases 5–6). Every profile read is audited.
7. Web: patient list and filters, a registration form matching the mobile wizard, a profile
   with tabs (Overview, Consent, History placeholder hidden until Phase 5), and the CHW
   assigned-patients count.
8. Tests: scope isolation per role, duplicate detection, idempotent creation by `clientId`,
   consent history, read auditing, and no PII in logs or audit metadata.
