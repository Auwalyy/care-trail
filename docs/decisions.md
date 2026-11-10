# CARETRAIL — Ambiguities, Decisions and Risks

## Ambiguities resolved (safe defaults — change by configuration, not code)

| # | Ambiguity | Decision |
|---|---|---|
| A1 | "Issuing facility **or** community" | `origin: {type: community \| facility}`; CHW referrals default to their community. |
| A2 | Who sets referral **priority** | Optional; only roles with `referral:set-priority` (facility workers / facility admins) may set it. CHWs cannot, because priority is a clinical judgement. |
| A3 | "Approved referral instructions" | Admin-managed instruction templates that need a recorded clinical approval before use. **Starts empty**: CARETRAIL ships no clinical instructions. |
| A4 | Antenatal/postnatal/immunisation **schedules** | Configurable schedule templates, empty by default. No WHO/NPHCDA schedule is hard-coded; the programme's clinical lead must supply it. |
| A5 | Escalation procedure | Configurable escalation contacts per programme or facility; escalation only records and notifies. |
| A6 | CHW referral authorisation | Per-CHW flag `canIssueReferrals` that a programme admin sets. |
| A7 | Offline login | Online first login is required. After that the app unlocks with a local PIN against the cached session, within a configurable offline grace period (default 14 days). |
| A8 | Patient ID format | Server-generated `CT-P-NNNNNN` per organisation. Offline patients show "Pending ID". |
| A9 | Referral code | `CT-XXXX-XXXX` in Crockford base32 with a check character. Generated only by the server. |
| A10 | Real-time (Socket.IO) | Not needed for the MVP. Facility queues poll every 30 s. Can be revisited. |
| A11 | Retention periods | The fields exist, but values need a programme/legal decision under the NDPA. Default: no automatic deletion. |
| A12 | SMS/voice provider | Provider interface plus `LogOnlyProvider`. No credentials are fabricated, and nothing is marked delivered without a provider. |
| A13 | CHW web access | CHWs use mobile. The web only exposes their profile. |
| A14 | Pilot figures (2/2/10/200/12 weeks) | Stored in `settings` as *targets*. Dashboards show actual vs. target. These are not confirmed deployments. |
| A15 | Patient sign-in | None in the MVP, as specified. |

## Critical technical risks

| Risk | Impact | Mitigation |
|---|---|---|
| MongoDB transactions need a replica set | Referral transitions and sync must be atomic | docker-compose runs a single-node replica set. Tests use `MongoMemoryReplSet`. Startup checks fail fast if transactions are unsupported. |
| Sync correctness (duplicates, lost writes, restarts) | Patient safety and data integrity | Idempotency ledger, `clientId` unique indexes, local transactional outbox, cursor saved with data, dependency ordering, tests for replay and crash. |
| SQLCipher on low-end Android | Performance/compatibility | Benchmark on a 2 GB RAM device in Phase 8. Keep the working set small (assigned patients only). |
| NativeWind 4 ↔ Tailwind 3 pin in a Tailwind 4 monorepo | Build breakage | Mobile declares its own `tailwindcss@3.4`. npm nests it. Verify `expo export`. |
| TypeScript 7 native port | Tool incompatibility | Pinned to TS 6.0. |
| Device clocks are wrong | Wrong ordering, false overdue | Server time is authoritative for status and overdue logic. Client time is stored separately as `clientRecordedAt`. |
| SMS cost and delivery in Nigeria (DND lists, sender ID registration) | Reminders not delivered | Provider abstraction, delivery receipts, consent checks, voice fallback. Sender ID registration is an operational task. |
| NDPA compliance | Legal | DPIA, NDPC registration and a DPO are organisational tasks. The platform provides consent, audit, minimisation, retention hooks and export/erasure tooling. |
| Clinical safety of content | Harm | Approval workflow is enforced in code. Unapproved content cannot be distributed. |
| Low digital literacy | Adoption | Large targets, icons + text, Hausa, a 6-step wizard with drafts, and usability testing with CHWs. |
