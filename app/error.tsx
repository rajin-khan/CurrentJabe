"use client";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <SiteHeader />
      <section className="not-found">
        <p className="eyebrow">Connection interrupted</p>
        <h1>The signal flickered.</h1>
        <p>No report was invented or lost silently. Try loading this view again.</p>
        <button className="button-primary" type="button" onClick={reset}>Try again</button>
      </section>
      <SiteFooter />
    </main>
  );
}
