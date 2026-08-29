import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "How CurrentJabe Predicts Load Shedding",
  description:
    "See how CurrentJabe turns anonymous electricity reports into live area status and likely outage windows without claiming an official schedule.",
  path: "/methodology",
});

export default function MethodologyPage() {
  return (
    <LegalShell title="How predictions work">
      <h2>Live status and predictions are separate</h2>
      <p>
        CurrentJabe distinguishes live community status, historical outage patterns and a
        next-24-hour forecast. A historical pattern never fabricates a live observation, and a
        forecast is never described as an official schedule.
      </p>

      <h2>Live community status</h2>
      <p>
        An area appears out only after at least ten independent private contributor identities
        report an outage within a rolling 24-hour window. The state expires after one hour
        unless newer qualifying reports refresh it. Ten recent positive confirmations can clear
        it earlier. To make cookie-reset spam less useful, no more than three contributors from
        the same daily rotating, one-way network token count toward either threshold. Raw IP
        addresses are never stored. Without qualifying evidence, the status is unknown, not “on.”
      </p>

      <h2>Geographic precision</h2>
      <p>
        Electricity networks do not follow administrative borders cleanly. Reports are grouped
        in the selected catalog area: a sourced finer locality where one is available, otherwise
        a thana or upazila. A locality is its own community evidence bucket, but it is not called
        a feeder and its approximate map highlight is only for orientation. Feeder-level grouping
        is used only when a utility reference supports it. District-wide observations are not
        combined into one prediction, and low-precision results are labelled accordingly.
      </p>

      <h2>Reported times and forecast strength</h2>
      <p>
        Every usable completed outage time appears in the public aggregated history, including a
        window supported by one person. Similar times are grouped, and no contributor identity or
        individual history is published. Sparse evidence may produce an early pattern, but
        CurrentJabe does not call it a forecast.
      </p>
      <p>A pattern receives the stronger community forecast label only when it has all of the following:</p>
      <ul>
        <li>Ten independent contributors.</li>
        <li>At least ten usable timed outage events.</li>
        <li>Reports across at least three distinct days.</li>
        <li>Evidence within the previous seven days.</li>
        <li>No single contributor dominating the evidence.</li>
        <li>No more than three contributors counted from one daily network token.</li>
      </ul>

      <h2>Time windows</h2>
      <p>
        Exact timestamps are retained, while the predictor analyses overlap in half-hour
        time-of-day bins. This is forecast resolution, separate from the 24-hour live-confirmation
        window. Recent, independent evidence receives more weight. The interface presents the
        strongest contiguous patterns as simple one-hour windows. Missing or forgotten times are
        never invented.
      </p>

      <h2>Accuracy</h2>
      <p>
        Report counts and evidence ranges are factual. Numeric accuracy appears only after
        forecasts have been made in advance and compared with later observations. Until then,
        CurrentJabe uses evidence strength rather than unsupported probability percentages.
      </p>
    </LegalShell>
  );
}
