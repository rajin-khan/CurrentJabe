import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export function LegalShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main>
      <SiteHeader />
      <section className="legal-shell">
        <div className="legal-shell__inner" lang="en">
          <header>
            <h1>{title}</h1>
          </header>
          <article className="legal-copy">{children}</article>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
