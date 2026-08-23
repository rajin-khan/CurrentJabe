# CurrentJabe database

This folder is for a **brand-new, isolated CurrentJabe Supabase project only**. The migrations have not been run against any local or remote database by Codex. Do not point these environment variables or migrations at The Program Company’s existing production data.

## Apply to a new project

1. Create a new Supabase project dedicated to CurrentJabe.
2. In that new project’s SQL editor, apply the files in filename order:
   - `202608230001_schema.sql`
   - `202608230002_public_functions.sql`
   - `202608230003_admin_functions.sql`
   - `202608230004_security.sql`
   - `202608230005_location_hierarchy.sql`
3. Configure the Vercel project with server-only secrets:

   ```text
   SUPABASE_URL=https://YOUR-ISOLATED-PROJECT.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   VISITOR_HASH_SECRET=at-least-32-random-characters
   ADMIN_USERNAME=...
   ADMIN_PASSWORD_HASH=pbkdf2_sha256$...
   ADMIN_SESSION_SECRET=at-least-32-random-characters
   ```

   `NEXT_PUBLIC_SUPABASE_URL` may exist for display/configuration, but the application does not need a browser Supabase client. Never expose `SUPABASE_SERVICE_ROLE_KEY`, `VISITOR_HASH_SECRET`, or the administrator secrets through `NEXT_PUBLIC_*` variables.
4. Generate the password hash locally without storing the password in source:

   ```sh
   printf '%s' 'a-long-unique-admin-password' | node scripts/hash-admin-password.mjs
   ```

5. Deploy the Next.js project and exercise the smoke-test requests below. No `supabase db reset`, schema drop, or destructive command is required.

### Existing CurrentJabe project

If migrations `001`–`004` were applied before locality support was added, apply only
`202608230005_location_hierarchy.sql`. It adds the missing hierarchy and map-metadata
columns without deleting or rewriting reports. Do not rerun the original schema file
against an existing project.

## Location bootstrap

The bundled `data/locations.json` is the public nationwide selector (495 upazilas, 61 metropolitan thanas and the sourced Mirpur DOHS locality across 64 districts). To avoid a second giant, drifting copy of the same catalog in SQL, the server inserts a catalog area into the isolated database the first time that area is opened or reported. Localities retain a parent-area reference and explicit exact, approximate or district-fallback map metadata. Inserts use conflict-ignore semantics and never reset an administrator-disabled area.

Provider hints from the bundled catalog are also inserted lazily as `probable` mappings only when they have a cited official coverage source. They are not labelled confirmed. BREB/PBS and BPDB are intentionally not inferred across whole upazilas without a reliable mapping.

This bootstrap still requires the schema migrations to exist before the first API request.

## Security model

- RLS is enabled on every application table.
- `anon` and `authenticated` receive no table, sequence, or RPC privileges.
- Only the isolated `service_role` can call the database contract; it remains inside Next.js route handlers.
- Reporters get a random, year-long, `HttpOnly`, `SameSite=Lax` browser cookie. The raw value is never stored or returned to JavaScript. HMAC-SHA256 hashes identify repeat contributions and can be deleted through the same cookie.
- IP addresses are never stored. A stable keyed HMAC is retained briefly in rate-limit rows. A separate keyed network HMAC rotates at each Dhaka calendar day and exists only on contribution rows so one shared network cannot manufacture an arbitrary number of “independent” reporters.
- Public reports contain no name, email, phone number, address, precise GPS coordinate, or public profile.
- Administrator login uses PBKDF2-SHA256 (310,000 iterations), a signed eight-hour `HttpOnly`, `SameSite=Strict` cookie, same-origin checks, an atomically reserved ten-failure/15-minute throttle, server authorization on every action, and audit records.
- The hidden/noindex admin page is only concealment; the signed session is the security boundary.

One percent of normal rate-limited actions opportunistically acquires a non-blocking maintenance lock and removes old rate-limit rows (7 days), login attempts (30 days), and long-expired live-state cache entries. `prune_operational_data()` is also available for an isolated scheduled job, but no daily operator work is required.

## Atomic data rules

- Live status accepts only `on` or `out` observations at a catalog location.
- Identical observations from one browser inside five minutes are deduplicated.
- A visitor is limited to 12 live actions/hour and 3 daily submissions/day. Shared-IP limits are emergency ceilings (2,000 live/hour and 1,000 daily/day), not normal user quotas, so carrier NAT, campuses, and offices are not accidentally locked out.
- Provider-scoped reporting is accepted only when that provider has an active, sourced mapping for the selected upazila. Feeder reporting additionally requires an exact active feeder/provider/upazila match.
- The state cache is computed separately for feeder, provider+upazila, and upazila ancestors.
- Ten independent, non-suppressed contributors inside a rolling 30-minute window activate a state. Only each visitor's latest observation counts, and at most three visitor identities from one daily network HMAC count toward a threshold.
- A qualifying state lasts one hour. New, non-duplicate observations for the winning state refresh it. Ten stronger/fresher positive confirmations can clear an outage early; duplicate taps never extend a state.
- An unclosed live outage is conservatively closed after one hour and marked approximate during the next area read/report or opportunistic cleanup. It then becomes forecast evidence and can never block a later outage indefinitely; no cron or operator action is required.
- “No recent status” is represented by no active cache row; it is never treated as proof that power is on.
- Daily reports accept only today/yesterday in `Asia/Dhaka`, an exact count or an unknown count with at least one remembered window, and exact/approximate windows of at most 24 hours.
- A user’s overlapping live and retrospective windows are suppressed as duplicates rather than double-counted.
- Forecast evidence must include 10 independent contributors, 10 timed events, 3 distinct days, evidence within 7 days, and no contributor above 20% of total weight. Forecast eligibility also caps each rotating network HMAC at three visitor identities.
- Exact timestamps remain stored. The server scores 30-minute bins, then presents non-overlapping, rounded one-hour windows for the next 24 hours.
- Forecasts are logged once per area/hour. Matured forecasts are evaluated against later independent outage evidence. Accuracy is not exposed until at least 20 forecasts have been evaluated.
- Analytics stores daily counters and one pseudonymous visitor/day row—no raw pageview stream, query text, ad profile, or cross-site identifier.

## API contract

Every endpoint returns either:

```json
{ "ok": true, "data": {} }
```

or:

```json
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

Public endpoints:

- `GET /api/visitor` — establishes the private browser identity.
- `GET /api/locations?query=&districtId=&upazilaId=` — catalog, providers, optional feeders/mappings.
- `GET /api/map/status` — currently corroborated upazila states only; omitted areas are unknown.
- `GET /api/areas/[slug]?providerId=&feederId=` — area, live state, evidence-gated forecast, qualified accuracy, official sources.
- `POST /api/reports/live`

  ```json
  { "state": "out", "location": { "upazilaId": "dhaka-mirpur", "providerId": "desco" } }
  ```

- `POST /api/reports/live/close`

  ```json
  { "eventId": "00000000-0000-4000-8000-000000000000" }
  ```

- `POST /api/reports/daily`

  ```json
  {
    "location": { "upazilaId": "dhaka-mirpur", "providerId": "desco" },
    "date": "2026-08-23",
    "countKnown": true,
    "outageCount": 2,
    "windows": [
      { "startTime": "10:00", "endTime": "11:00", "precision": "exact" },
      { "startTime": "19:20", "endTime": "20:15", "precision": "approximate" }
    ]
  }
  ```

- `GET /api/reports/mine?date=YYYY-MM-DD&upazilaId=...&providerId=...&feederId=...` — the caller’s same-day events for deduplication UI.
- `DELETE /api/me/reports` with `{ "confirm": true }` — hard-deletes the private identity’s reports/visitor-day rows and expires its cookie. Already-aggregated anonymous daily counters are not personal records and remain.
- `POST /api/analytics` with an allowlisted operational event.

Administrator endpoints (all send `X-Robots-Tag: noindex, nofollow, noarchive`):

- `POST /api/admin/auth/login`, `POST /api/admin/auth/logout`, `GET /api/admin/auth/session`
- `GET /api/admin/reports`, `PATCH /api/admin/reports/[id]`
- `GET /api/admin/areas`, `PATCH /api/admin/areas/[id]`
- `GET /api/admin/analytics?days=30` for aggregate events and unique anonymous visitor-days
- `GET /api/admin/audit`
- `GET|PATCH /api/admin/settings` for submissions, public message, and global kill switch

## New-project smoke tests

After environment variables point to the isolated project:

1. `GET /api/locations?query=Mirpur` returns catalog locations and providers.
2. `GET /api/areas/dhaka-mirpur` lazily inserts only that district/area and returns `unknown` live state.
3. A first `POST /api/reports/live` returns an event id and still reports `unknown`; one browser can never unlock an area by tapping repeatedly.
4. `POST /api/reports/live/close` closes only that private browser’s event.
5. A duplicate daily report is idempotent and returns `duplicate: true`.
6. A different browser cannot close or delete another browser’s data.
7. Direct REST calls using the anon key cannot select or mutate application tables.
8. Admin mutations fail without the signed cookie and create an audit entry when authorized.
