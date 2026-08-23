import rawLocations from "@/data/locations.json";
import type { LocationKind, LocationSelection, MapCoverageKind } from "./types";

export type CatalogLocation = {
  id: string;
  slug: string;
  district: string;
  districtBn: string;
  upazila: string;
  upazilaBn?: string;
  providerHints: string[];
  providerMappings?: Array<{
    providerId: string;
    sourceUrl: string;
    sourceLabel: string;
    confidence: "confirmed" | "probable" | "unverified";
  }>;
  kind: LocationKind;
  parentId?: string;
  geometryAvailable: boolean;
  approximateMapFeatureIds?: string[];
  mapCoverage?: MapCoverageKind;
};

const locations = rawLocations as CatalogLocation[];
const byId = new Map(locations.map((location) => [location.id, location]));
const bySlug = new Map(locations.map((location) => [location.slug, location]));

export function slugifyCatalogName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function districtIdFor(location: CatalogLocation): string {
  return slugifyCatalogName(location.district);
}

export function catalogLocationById(id: string): CatalogLocation | null {
  return byId.get(id) ?? null;
}

export function catalogLocationBySlug(slug: string): CatalogLocation | null {
  return bySlug.get(slug) ?? null;
}

export function allCatalogLocations(): readonly CatalogLocation[] {
  return locations;
}

export function assertCatalogSelection(location: LocationSelection): CatalogLocation {
  const match = catalogLocationById(location.upazilaId);
  if (!match) throw new Error("invalid_upazila");
  if (match.parentId && !catalogLocationById(match.parentId)) {
    throw new Error("invalid_parent_location");
  }
  if (location.districtId && location.districtId !== districtIdFor(match)) {
    throw new Error("invalid_district_for_upazila");
  }
  if (location.providerId && match.providerHints.length > 0 && !match.providerHints.includes(location.providerId)) {
    // Hints are intentionally non-authoritative, so a mismatch is allowed. The
    // official mapping table remains the only source shown as verified.
  }
  return match;
}
