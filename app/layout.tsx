import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { LanguageProvider } from "@/components/language-provider";
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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "CurrentJabe — Bangladesh community outage map",
    template: "%s · CurrentJabe",
  },
  description:
    "See community-reported electricity status and likely outage windows across Bangladesh. Anonymous, evidence-led and free to use.",
  applicationName: "CurrentJabe",
  keywords: [
    "Bangladesh load shedding",
    "electricity outage",
    "current jabe",
    "load shedding predictor",
    "community outage map",
  ],
  authors: [{ name: "The Program Company", url: "https://theprogram.company" }],
  creator: "The Program Company",
  openGraph: {
    type: "website",
    locale: "en_BD",
    siteName: "CurrentJabe",
    title: "Current Jabe Kokhon? · CurrentJabe",
    description:
      "A live, community-powered electricity outage map and forecast for Bangladesh.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Current Jabe Kokhon? · CurrentJabe",
    description:
      "A live, community-powered electricity outage map and forecast for Bangladesh.",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#e23b2e",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${satoshi.variable} ${laBelleAurore.variable} ${coldiacLogo.variable} ${babyBlocksLogo.variable} ${notoBengali.variable}`}
      suppressHydrationWarning
    >
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
