import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AreaPageExperience } from "@/components/area-page-experience";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getLocationBySlug } from "@/lib/locations";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const location = getLocationBySlug(slug);
  if (!location) return { title: "Area not found" };
  return {
    title: `${location.upazila} electricity status`,
    description: `Community electricity status and next-24-hour outage evidence for ${location.upazila}, ${location.district}, Bangladesh.`,
    alternates: { canonical: `/area/${location.slug}` },
    openGraph: {
      title: `${location.upazila} power status and prediction`,
      description: `See and contribute to the community electricity signal for ${location.upazila}.`,
    },
  };
}

export default async function AreaPage({ params }: Props) {
  const { slug } = await params;
  const location = getLocationBySlug(slug);
  if (!location) notFound();

  return (
    <main>
      <SiteHeader />
      <AreaPageExperience location={location} />
      <SiteFooter />
    </main>
  );
}
