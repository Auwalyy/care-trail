# CARETRAIL — Navigation

## Web (Next.js App Router)

```
/login  /forgot-password  /reset-password?token=
/(dashboard)                      ← authenticated shell: collapsible sidebar, top bar
  /dashboard                      overview (role-aware)
  /patients                       list, filters
  /patients/new
  /patients/[id]                  profile tabs: Overview · Referrals · Appointments · Follow-ups · Visits · Consent
  /referrals                      list (facility: incoming queue)
  /referrals/verify               enter/scan referral code
  /referrals/[id]                 detail + status timeline + actions
  /appointments
  /follow-ups                     task board
  /chws  /chws/[id]
  /facilities  /facilities/[id]
  /communities
  /organisations                  platform admin
  /users
  /education  /education/[id]    CMS with review/approval
  /notifications                  history
  /analytics                      reports + export
  /audit-logs
  /settings                       programme / pilot configuration
  /profile
```

Sidebar items are filtered by permission for usability, but every page's data comes from
permission-checked API calls.

Role landing pages after login:
* platform_admin → `/dashboard` (platform overview)
* programme_admin → `/dashboard` (programme overview)
* facility_admin / facility_worker → `/referrals` (incoming queue)
* chw → web access limited to `/profile`; the CHW tool is the mobile app.

## Mobile (Expo Router)

```
app/
  (auth)/login.tsx  (auth)/unlock.tsx       offline unlock with PIN against cached session
  (tabs)/
    index.tsx            Home: counts, last sync, online/offline badge
    patients/index.tsx   search + list
    patients/[id].tsx    profile, quick actions (visit, referral, appointment)
    referrals/index.tsx  my referrals with sync state
    tasks/index.tsx      follow-up tasks
    profile/index.tsx    language, sync, logout
  register/[step].tsx    6-step registration wizard (draft auto-saved)
  referral/new.tsx  referral/[id]/receipt.tsx
  visit/new.tsx  appointment/new.tsx  task/[id].tsx
  sync.tsx               outbox status, conflicts, manual sync
  education/…            approved content (read-only)
```
