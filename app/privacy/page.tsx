import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";
import { PrivacyDelete } from "@/components/privacy-delete";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How CurrentJabe minimizes and protects community report data.",
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy">
      <h2>The short version</h2>
      <p>
        You do not need an account. We do not ask for your name, phone number, email, home
        address or precise GPS location. Reports are aggregated to administrative and, when
        voluntarily known, electricity-provider areas.
      </p>

      <h2>What this browser stores</h2>
      <p>
        The server places a random, private contributor cookie in this browser. It is not a
        public profile. It lets CurrentJabe count independent contributors, prevent duplicate
        reports, build a reliability history and delete this browser’s reports on request.
      </p>

      <h2>What a report contains</h2>
      <ul>
        <li>Your selected district and upazila or thana.</li>
        <li>An optional provider, PBS, local office or feeder when you know it.</li>
        <li>Whether electricity appears on or out, and the relevant times.</li>
        <li>
          A daily rotating, one-way network token for abuse resistance. Raw IP addresses are
          never stored.
        </li>
      </ul>

      <h2>What the public sees</h2>
      <p>
        The public sees only aggregated area status, evidence counts, historical patterns and
        forecasts. CurrentJabe never publishes an individual report location, contributor
        history or household-level pin.
      </p>

      <h2>Service providers</h2>
      <p>
        The application is designed for Vercel hosting and an isolated Supabase database.
        Their infrastructure processes requests needed to run the service. We do not sell
        report data or use it for advertising profiles.
      </p>

      <h2>Retention and safety</h2>
      <p>
        Coarse outage events may be retained to evaluate recurring patterns. Rate-limit tokens
        are short-lived, and network tokens rotate each Dhaka calendar day. Aggregation
        thresholds and coarse geography reduce household-security risk.
      </p>

      <PrivacyDelete />

      <h2>Questions</h2>
      <p>
        For privacy questions, contact The Program Company through
        {" "}<a href="https://theprogram.company">theprogram.company</a>.
      </p>
    </LegalShell>
  );
}
