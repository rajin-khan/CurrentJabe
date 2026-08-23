import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SubmitExperience } from "@/components/submit-experience";

export const metadata: Metadata = {
  title: "Submit a report",
  description: "Anonymously report electricity status or recent outages in your Bangladesh area.",
};

export default function SubmitPage() {
  return (
    <main>
      <SiteHeader />
      <SubmitExperience />
      <SiteFooter />
    </main>
  );
}
