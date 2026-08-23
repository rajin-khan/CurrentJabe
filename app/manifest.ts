import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CurrentJabe — Bangladesh Outage Map",
    short_name: "CurrentJabe",
    description:
      "Community electricity status reports and likely load-shedding windows across Bangladesh.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4efe6",
    theme_color: "#e34232",
    lang: "en-BD",
    categories: ["utilities", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
