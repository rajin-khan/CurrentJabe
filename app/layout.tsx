import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { LanguageProvider } from "@/components/language-provider";
import { StructuredData } from "@/components/structured-data";
import {
  PROGRAM_COMPANY_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
  SOCIAL_IMAGE,
} from "@/lib/seo";
import "./globals.css";

const satoshi = localFont({
  src: [
    { path: "./fonts/satoshi-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/satoshi-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/satoshi-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
});

const laBelleAurore = localFont({
  src: "./fonts/la-belle-aurore.woff2",
  variable: "--font-la-belle",
  weight: "400",
  style: "normal",
  display: "swap",
});

const coldiacLogo = localFont({
  src: "./fonts/coldiac.ttf",
  variable: "--font-coldiac-logo",
  weight: "400",
  style: "normal",
  display: "swap",
});

const babyBlocksLogo = localFont({
  src: "./fonts/baby-blocks.ttf",
  variable: "--font-baby-blocks-logo",
  weight: "400",
  style: "normal",
  display: "swap",
});

const notoBengali = localFont({
  src: [
    { path: "./fonts/noto-sans-bengali-400.ttf", weight: "400", style: "normal" },
    { path: "./fonts/noto-sans-bengali-500.ttf", weight: "500", style: "normal" },
    { path: "./fonts/noto-sans-bengali-600.ttf", weight: "600", style: "normal" },
    { path: "./fonts/noto-sans-bengali-700.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-bengali",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s · CurrentJabe",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  category: "utilities",
  referrer: "origin-when-cross-origin",
  keywords: [
    "CurrentJabe",
    "Bangladesh load shedding",
    "Bangladesh power cut schedule",
    "electricity outage",
    "current jabe",
    "current jabe kokhon",
    "load shedding predictor",
    "community outage map",
    "কারেন্ট যাবে কখন",
    "বাংলাদেশ লোডশেডিং",
    "বিদ্যুৎ বিভ্রাট",
  ],
  authors: [{ name: "The Program Company", url: PROGRAM_COMPANY_URL }],
  creator: "The Program Company",
  publisher: "The Program Company",
  formatDetection: { address: false, email: false, telephone: false },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    locale: "en_BD",
    siteName: SITE_NAME,
    title: "Current Jabe Kokhon? · CurrentJabe",
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Current Jabe Kokhon? · CurrentJabe",
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE.url],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION },
  other: { "geo.region": "BD", "geo.placename": "Bangladesh" },
};

export const viewport: Viewport = {
  themeColor: "#e23b2e",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${PROGRAM_COMPANY_URL}/#organization`,
      name: "The Program Company",
      url: PROGRAM_COMPANY_URL,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      alternateName: "Current Jabe Kokhon?",
      description: SITE_DESCRIPTION,
      image: `${SITE_URL}${SOCIAL_IMAGE.url}`,
      publisher: { "@id": `${PROGRAM_COMPANY_URL}/#organization` },
      inLanguage: ["en-BD", "bn-BD"],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#application`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "BDT" },
      areaServed: { "@type": "Country", name: "Bangladesh" },
      inLanguage: ["en-BD", "bn-BD"],
      featureList: [
        "Community electricity status reports",
        "Historical outage-time reporting",
        "Community-powered outage predictions",
        "Bangladesh area map",
      ],
      publisher: { "@id": `${PROGRAM_COMPANY_URL}/#organization` },
    },
  ];

  return (
    <html
      lang="en"
      className={`${satoshi.variable} ${laBelleAurore.variable} ${coldiacLogo.variable} ${babyBlocksLogo.variable} ${notoBengali.variable}`}
      suppressHydrationWarning
    >
      <body>
        <StructuredData data={structuredData} />
        <a className="skip-link" href="#main-content">Skip to content</a>
        <div id="main-content" tabIndex={-1}>
          <LanguageProvider>{children}</LanguageProvider>
        </div>
      </body>
    </html>
  );
}
