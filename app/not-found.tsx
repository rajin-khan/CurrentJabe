import Link from "next/link";
import { ArrowIcon } from "@/components/icons";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <main>
      <SiteHeader />
      <section className="not-found">
        <p className="eyebrow">404 · Signal lost</p>
        <h1>This area is off the map.</h1>
        <p>Return to Bangladesh and search for another district, upazila or thana.</p>
        <Link className="button-primary" href="/">
          Return to the live map <ArrowIcon />
        </Link>
      </section>
      <SiteFooter />
    </main>
  );
}
