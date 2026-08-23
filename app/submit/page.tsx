import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SubmitExperience } from "@/components/submit-experience";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Report a Power Outage in Bangladesh",
  description:
    "Anonymously report whether electricity is on or out, or add outage times from today or yesterday for your area in Bangladesh.",
  path: "/submit",
});

export default function SubmitPage() {
  return (
    <main>
      <SiteHeader />
      <SubmitExperience />
      <SiteFooter />
    </main>
  );
}
