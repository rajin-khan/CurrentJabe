<p align="center">
  <img src="./public/brand/currentjabe-mark-v3.png" alt="CurrentJabe lightning mark" width="104" />
</p>

<h1 align="center">CurrentJabe</h1>

<p align="center">
  <strong>Current Jabe Kokhon?</strong><br />
  A community-powered electricity outage map and predictor for Bangladesh.
</p>

<p align="center">
  <a href="#what-you-can-do">Features</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#privacy-by-design">Privacy</a> ·
  <a href="#run-locally">Local setup</a>
</p>

CurrentJabe turns small, anonymous community reports into a clearer picture of local electricity outages. People can check recent reports, contribute the outage times they remember, and see likely outage windows once their area has gathered enough evidence.

It is built around a practical question: **when should I charge, plan, study, work, or prepare for the power to go out?**

> CurrentJabe publishes community estimates, not official utility schedules. It shows “not enough data” instead of inventing certainty.

## What you can do

- Search all 64 districts, 495 upazilas, supported metropolitan thanas, and selected smaller localities such as Mirpur DOHS.
- Explore a responsive, interactive map of Bangladesh.
- Check whether an area has a recent community signal: **on**, **out**, or **unknown**.
- Report the current status in seconds without creating an account.
- Add remembered outage windows from today or yesterday, even if you remember only one.
- View a next-24-hour community prediction after the area earns enough evidence.
- Share a direct area page with its live status and prediction.
- Use the interface in English or Bangla.

## How it works

1. **Report** — someone says the current is on or out, or records a recent outage window.
2. **Corroborate** — independent reports from the same area strengthen or contradict the signal.
3. **Predict** — recurring time patterns become visible only after the area crosses the evidence threshold.

| Result | Minimum evidence | Behaviour |
| --- | --- | --- |
| Live status | 10 independent contributors within a rolling 24-hour window | The area appears on or out. The state expires after one hour unless qualifying reports refresh or reverse it. |
| Next-24-hour prediction | 10 independent contributors, 10 usable timed events, reports across 3 days, and recent evidence | The strongest recurring outage windows appear with their sample size and evidence range. |

The predictor compares outage overlap in half-hour time-of-day bins, separate from the 24-hour live-confirmation window, and presents the strongest contiguous patterns as clear one-hour windows. Recent, independent evidence receives more weight.

Silence is never treated as proof that electricity is on. Without enough qualifying evidence, the status remains **unknown**.

## Privacy by design

CurrentJabe does not ask contributors for a name, email address, phone number, street address, or precise GPS location.

Abuse controls use a private browser identifier and a daily rotating, one-way network token. Raw IP addresses are not stored. Public results are aggregated so individual reports are not exposed as personal activity.

## Geographic accuracy

Electricity networks do not follow administrative borders perfectly. Reports are grouped at the most precise shared level that can be supported: a known feeder or local utility office, a locality, or an upazila-wide fallback.

Administrative boundaries are used for orientation and are **not** presented as electricity feeder boundaries. Boundary data comes from the Bangladesh Bureau of Statistics and OCHA ROAP via geoBoundaries under CC BY 3.0 IGO. Provider hints are included only when supported by public information from the relevant electricity authority.

See [`data/SOURCES.md`](./data/SOURCES.md) for full provenance, pinned revisions, attribution, and known limitations.

## Technology

- Next.js and React
- TypeScript
- Supabase Postgres with Row Level Security
- Responsive, code-native SVG map geometry
- Vercel-ready deployment

## Run locally

Requirements: Node.js 22+ and [pnpm](https://pnpm.io/).

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The interface can render without live community data, but reporting and predictions require a configured Supabase project.

### Configure Supabase

Use a dedicated Supabase project for CurrentJabe. Apply the SQL files in [`supabase/migrations`](./supabase/migrations) in filename order, then configure the variables documented in [`.env.example`](./.env.example).

Generate the administrator password hash locally without storing the password in source:

```sh
printf '%s' 'a-long-unique-password' | node scripts/hash-admin-password.mjs
```

Keep the service-role key, visitor secret, password hash, and session secret server-side. Never expose them through a `NEXT_PUBLIC_` variable or commit a populated environment file.

### Quality checks

```sh
pnpm typecheck
pnpm build
node scripts/geo/validate.mjs
```

## Deploy

Import the `currentjabe` directory into Vercel, keep the detected Next.js settings, add the environment variables from `.env.example`, and set `NEXT_PUBLIC_SITE_URL` to the public origin.

The core application can run within the free allowances of Vercel and Supabase, subject to each provider’s current usage limits.

## Contributing

Issues and pull requests are welcome for:

- administrative-name and geography corrections;
- responsibly sourced electricity-provider mappings;
- Bangla translations;
- accessibility and responsive-design improvements;
- methodology, privacy, and abuse-resistance fixes.

Please include a reliable public source with any geographic or electricity-provider correction. Do not submit personal outage details, precise household locations, credentials, or private utility records.

## Disclaimer

CurrentJabe is independent community software. It is not affiliated with an electricity provider or government authority, and its estimates can be incomplete or wrong. Do not rely on it for medical, emergency, or safety-critical decisions.

## Credits

Built by [The Program Company](https://theprogramcompany.vercel.app) × Rajin Khan.
