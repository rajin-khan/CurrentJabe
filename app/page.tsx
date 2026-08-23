import type { Metadata } from "next";
import { HomeExperience } from "@/components/home-experience";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { createPageMetadata, SITE_DESCRIPTION, SITE_TITLE } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  path: "/",
  socialTitle: "Current Jabe Kokhon? · Bangladesh Power Outage Map",
  absoluteTitle: true,
});

export default function HomePage() {
  return (
    <main>
      <SiteHeader />
      <HomeExperience />
      <SiteFooter />
    </main>
  );
}
