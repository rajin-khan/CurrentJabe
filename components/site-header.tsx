"use client";

import Link from "next/link";
import { CurrentJabeWordmark } from "@/components/brand-mark";
import { useLanguage } from "@/components/language-provider";

export function SiteHeader({ inverse = false }: { inverse?: boolean }) {
  const { text, toggleLocale } = useLanguage();

  return (
    <header className={`site-header${inverse ? " site-header--inverse" : ""}`}>
      <Link className="site-header__brand" href="/" aria-label="CurrentJabe home">
        <CurrentJabeWordmark />
      </Link>
      <div className="site-header__actions">
        <button className="language-toggle" type="button" onClick={toggleLocale}>
          <span aria-hidden="true">অ / A</span>
          {text.nav.language}
        </button>
      </div>
    </header>
  );
}
