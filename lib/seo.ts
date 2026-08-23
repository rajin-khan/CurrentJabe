import "server-only";

import type { Metadata } from "next";

const FALLBACK_SITE_URL = "https://current-jabe.vercel.app";

function normalizeSiteUrl(value: string | undefined): string {
  if (!value) return FALLBACK_SITE_URL;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      return FALLBACK_SITE_URL;
    }
    return url.origin;
  } catch {
    return FALLBACK_SITE_URL;
  }
}

export const SITE_URL = normalizeSiteUrl(
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL,
);
export const SITE_NAME = "CurrentJabe";
export const SITE_TITLE = "CurrentJabe | Bangladesh Load Shedding Map & Predictor";
export const SITE_DESCRIPTION =
  "Check live electricity reports and likely load-shedding times across Bangladesh. Report outages anonymously and help your area predict power cuts.";
export const PROGRAM_COMPANY_URL = "https://theprogramcompany.vercel.app";
export const SOCIAL_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "Current Jabe Kokhon? Bangladesh community electricity outage map and predictor",
  type: "image/png",
} as const;

export function createPageMetadata({
  title,
  description,
  path,
  socialTitle,
  absoluteTitle = false,
  noIndex = false,
  image = SOCIAL_IMAGE,
}: {
  title: string;
  description: string;
  path: `/${string}` | "/";
  socialTitle?: string;
  absoluteTitle?: boolean;
  noIndex?: boolean;
  image?: typeof SOCIAL_IMAGE;
}): Metadata {
  const shareTitle = socialTitle ?? `${title} | ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      locale: "en_BD",
      siteName: SITE_NAME,
      title: shareTitle,
      description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description,
      images: [image.url],
    },
    ...(noIndex
      ? { robots: { index: false, follow: false, nocache: true } }
      : {}),
  };
}
