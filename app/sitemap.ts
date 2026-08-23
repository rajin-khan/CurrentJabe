import type { MetadataRoute } from "next";
import { locations } from "@/lib/locations";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const staticPages: MetadataRoute.Sitemap = ["", "/submit", "/privacy", "/methodology", "/sources"].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: path === "" ? "hourly" : "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
  const areaPages: MetadataRoute.Sitemap = locations.map((location) => ({
    url: `${baseUrl}/area/${location.slug}`,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: 0.7,
  }));
  return [...staticPages, ...areaPages];
}
