"use client";

import Link from "next/link";
import { CurrentJabeWordmark } from "@/components/brand-mark";
import { ArrowIcon } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";

export function SiteHeader({ inverse = false }: { inverse?: boolean }) {
  const { text, toggleLocale } = useLanguage();

  return (
    <header className={`site-header${inverse ? " site-header--inverse" : ""}`}>
      <Link className="site-header__brand" href="/" aria-label="CurrentJabe home">
        <CurrentJabeWordmark />
      </Link>
      <nav className="site-header__nav" aria-label="Primary navigation">
        <Link href="/#live-map">{text.nav.map}</Link>
        <Link href="/#predictor">{text.nav.predictor}</Link>
      </nav>
      <div className="site-header__actions">
        <button className="language-toggle" type="button" onClick={toggleLocale}>
          <span aria-hidden="true">অ / A</span>
          {text.nav.language}
        </button>
        <Link className="header-report" href="/submit">
          {text.nav.report}
          <ArrowIcon />
        </Link>
      </div>
    </header>
  );
}
