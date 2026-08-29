"use client";

import Link from "next/link";
import { ArrowIcon } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";

export function SiteFooter() {
  const { text } = useLanguage();

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="footer-brand">
          <a
            className="footer-logo"
            href="https://theprogramcompany.vercel.app"
            target="_blank"
            rel="noreferrer"
            aria-label="Visit The Program Company"
          >
            <span className="footer-logo__the">THE</span>
            <span className="footer-logo__program">PrOgRaM</span>
            <span className="footer-logo__company">COMPANY</span>
          </a>
        </div>
        <div className="footer-center">
          <nav aria-label="Footer navigation">
            <Link href="/areas">{text.footer.areas}</Link>
            <Link href="/privacy">{text.footer.privacy}</Link>
            <Link href="/methodology">{text.footer.method}</Link>
            <Link href="/sources">{text.footer.source}</Link>
          </nav>
          <p>{text.footer.disclaimer}</p>
        </div>
        <div className="footer-credit">
          <a
            className="who-we-are"
            href="https://theprogramcompany.vercel.app"
            target="_blank"
            rel="noreferrer"
          >
            {text.footer.who}
            <ArrowIcon />
          </a>
        </div>
      </div>
    </footer>
  );
}
