import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AreaPageExperience } from "@/components/area-page-experience";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import { SITE_NAME, SITE_URL } from "@/lib/seo";
import { resolvePublicLocation } from "@/lib/server/localities";

type Props = { params: Promise<{ slug: string }> };

const getLocation = cache(async (slug: string) =>
  resolvePublicLocation(slug).catch(() => null),
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const location = await getLocation(slug);
  if (!location) {
    return {
      title: "Area not found",
      robots: { index: false, follow: false },
    };
  }
  const title = `${location.upazila} Load Shedding Status, ${location.district}`;
  const socialTitle = `${location.upazila}, ${location.district} Power Status | ${SITE_NAME}`;
  const description = `Check community electricity status, recent outage evidence and likely load-shedding windows for ${location.upazila}, ${location.district}, Bangladesh.`;
  const path = `/area/${location.slug}`;
  const imagePath = `${path}/opengraph-image/default`;
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: location.origin && location.origin !== "catalog"
      ? { index: false, follow: true }
      : undefined,
    openGraph: {
      type: "website",
      url: path,
      locale: "en_BD",
      siteName: SITE_NAME,
      title: socialTitle,
      description,
      images: [{
        url: imagePath,
        width: 1200,
        height: 630,
        alt: `${location.upazila}, ${location.district} community electricity status and prediction`,
        type: "image/png",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [imagePath],
    },
  };
}

export default async function AreaPage({ params }: Props) {
  const { slug } = await params;
  const location = await getLocation(slug);
  if (!location) notFound();

  const pageUrl = `${SITE_URL}/area/${location.slug}`;
  const description = `Community electricity status and likely outage windows for ${location.upazila}, ${location.district}, Bangladesh.`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${pageUrl}#webpage`,
    url: pageUrl,
    name: `${location.upazila} electricity status, ${location.district}`,
    description,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: {
      "@type": "Place",
      name: location.upazila,
      alternateName: location.upazilaBn || undefined,
      containedInPlace: {
        "@type": "AdministrativeArea",
        name: location.district,
      },
    },
    inLanguage: ["en-BD", "bn-BD"],
  };

  return (
    <main>
      <StructuredData data={structuredData} />
      <SiteHeader />
      <AreaPageExperience location={location} />
      <SiteFooter />
    </main>
  );
}
