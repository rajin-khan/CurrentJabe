import type { MetadataRoute } from "next";
import { locations } from "@/lib/locations";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { path: "", frequency: "hourly" as const, priority: 1 },
    { path: "/areas", frequency: "weekly" as const, priority: 0.9 },
    { path: "/submit", frequency: "monthly" as const, priority: 0.8 },
    { path: "/methodology", frequency: "monthly" as const, priority: 0.6 },
    { path: "/sources", frequency: "monthly" as const, priority: 0.5 },
    { path: "/privacy", frequency: "yearly" as const, priority: 0.3 },
  ].map(({ path, frequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: frequency,
    priority,
  }));
  const areaPages: MetadataRoute.Sitemap = locations.map((location) => ({
    url: `${SITE_URL}/area/${location.slug}`,
    changeFrequency: "daily",
    priority: location.kind === "locality" ? 0.72 : 0.75,
  }));
  return [...staticPages, ...areaPages];
}
