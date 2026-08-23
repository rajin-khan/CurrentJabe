# CurrentJabe

CurrentJabe is a community-powered electricity-status map and outage forecaster for Bangladesh. It accepts anonymous live confirmations and today/yesterday outage history, then reveals a forecast only after an area has enough independent evidence.

The app is a standalone Next.js project for a new Vercel project and a new, isolated Supabase project. It does not need a custom domain and does not contain fake launch data.

## What is included

- Searchable nationwide catalog: 495 upazilas, 61 metropolitan thanas and the sourced Mirpur DOHS locality across 64 districts
- Interactive Bangladesh boundary map with district fallback for 12 newer upazilas and an explicitly approximate Pallabi–Turag highlight for Mirpur DOHS
- English-first UI with a persistent Bangla toggle
- Anonymous live `on` / `out` confirmations and two-step daily history reporting
- Evidence-gated, one-hour forecast windows built from 30-minute internal bins
- Shareable, indexed area pages with dynamic social cards
- Private, noindex operator CMS at `/signal-room`
- Aggregate-only analytics, hard deletion by browser identity, and no PII/GPS collection
- Full Supabase schema, RLS lockdown, rate limits, deduplication, forecast evaluation, and audit log

## Run locally

Requirements: Node.js 22+ and pnpm.

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

The public UI intentionally degrades to an explicit “temporarily unavailable” state until its isolated Supabase project is configured.

Useful checks:

```sh
pnpm typecheck
pnpm build
node scripts/geo/validate.mjs
```

## Configure the isolated backend

Create a brand-new Supabase project for CurrentJabe. Do not point this project at an existing production database.

Apply the five files in [`supabase/migrations`](./supabase/migrations) in filename order using the new project’s SQL editor. No reset, drop, or destructive database command is needed. The complete schema, security model, API contract, and smoke tests are documented in [`supabase/README.md`](./supabase/README.md).

Set these values locally and in the new Vercel project:

```text
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
VISITOR_HASH_SECRET=32-or-more-random-characters
ADMIN_USERNAME=...
ADMIN_PASSWORD_HASH=pbkdf2_sha256$...
ADMIN_SESSION_SECRET=32-or-more-random-characters
NEXT_PUBLIC_SITE_URL=https://YOUR-PROJECT.vercel.app
```

Generate the administrator password hash locally:

```sh
printf '%s' 'a-long-unique-password' | node scripts/hash-admin-password.mjs
```

Keep the service-role key, visitor secret, password hash, and session secret server-only. None may use a `NEXT_PUBLIC_` prefix.

## Deploy on Vercel

1. Import the `currentjabe` directory as a new Vercel project.
2. Keep the detected Next.js framework settings and use pnpm.
3. Add the environment variables above for Production and Preview as appropriate.
4. Deploy, then run the smoke tests in [`supabase/README.md`](./supabase/README.md).
5. Sign in at `/signal-room` and leave submissions enabled.

The architecture has no required paid service beyond usage that exceeds the hosting/database providers’ available free quotas. A custom domain can be attached later without changing the app.

## Evidence rules

- Live states require 10 independent, non-suppressed contributors in a rolling 30-minute window.
- No more than three contributors from one daily rotating network token count toward a threshold; raw IP addresses are never stored.
- A qualifying state lasts one hour and can be refreshed by new independent evidence.
- An abandoned open-ended live outage is closed after one hour for forecast evidence.
- Ten stronger/fresher positive confirmations can clear an outage early.
- Silence is always “No recent status,” never proof that electricity is on.
- Forecasts require 10 independent contributors, 10 timed events, three reporting days, recent evidence, and the same network cap.
- Exact observations stay exact in storage; public predictions are rounded to useful one-hour windows.

## Geography and attribution

Source provenance, pinned revisions, licensing, known geometry gaps, and provider-hint limitations live in [`data/SOURCES.md`](./data/SOURCES.md). Administrative borders are orientation only and are not claimed to be utility feeder boundaries.

## Brand

CurrentJabe is presented as a community utility by [The Program Company](https://theprogram.company). The full company logo and “Who we are” link appear in the public footer.
