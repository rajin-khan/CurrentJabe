import rawLocations from "@/data/locations.json";
import type { LocationKind, MapCoverageKind } from "@/lib/domain/types";

export type ProviderId = "bpdb" | "breb" | "dpdc" | "desco" | "wzpdcl" | "nesco";

export interface LocationRecord {
  id: string;
  slug: string;
  district: string;
  districtBn?: string;
  upazila: string;
  upazilaBn?: string;
  providerHints: readonly ProviderId[];
  providerMappings?: readonly {
    providerId: ProviderId;
    sourceUrl: string;
    sourceLabel: string;
    confidence: "confirmed" | "probable" | "unverified";
  }[];
  kind: LocationKind;
  parentId?: string;
  geometryAvailable: boolean;
  approximateMapFeatureIds?: readonly string[];
  mapCoverage?: MapCoverageKind;
  aliases?: readonly string[];
  origin?: "catalog" | "community" | "admin";
  communityAdded?: boolean;
}

export interface DistrictRecord {
  name: string;
  nameBn?: string;
  slug: string;
  locationCount: number;
}

export interface ProviderDefinition {
  id: ProviderId;
  shortName: string;
  name: string;
  nameBn: string;
  officialUrl: string;
  coverageSourceUrl: string;
  coverageNote: string;
}

/**
 * Provider hints are candidates, never proof of service. Electricity territories
 * commonly split an administrative unit by urban/rural network or feeder.
 */
export const providers: readonly ProviderDefinition[] = [
  {
    id: "bpdb",
    shortName: "BPDB",
    name: "Bangladesh Power Development Board",
    nameBn: "বাংলাদেশ বিদ্যুৎ উন্নয়ন বোর্ড",
    officialUrl: "https://bpdb.gov.bd/",
    coverageSourceUrl: "https://bpdb.gov.bd/site/page/d8f6f2c3-2153-4751-b887-ec12caa5e4e9/-",
    coverageNote: "Serves many urban areas outside the separately listed distribution companies; no ADM3-wide hint is inferred.",
  },
  {
    id: "breb",
    shortName: "BREB / PBS",
    name: "Bangladesh Rural Electrification Board / Palli Bidyut Samity",
    nameBn: "বাংলাদেশ পল্লী বিদ্যুতায়ন বোর্ড / পল্লী বিদ্যুৎ সমিতি",
    officialUrl: "https://reb.gov.bd/",
    coverageSourceUrl: "https://reb.gov.bd/site/page/c08b56bd-c300-4d08-8ea2-c25eedffbfdb/At-a-Glance",
    coverageNote: "Serves rural networks through PBS organizations; a verified upazila-to-PBS table is not bundled yet.",
  },
  {
    id: "dpdc",
    shortName: "DPDC",
    name: "Dhaka Power Distribution Company",
    nameBn: "ঢাকা পাওয়ার ডিস্ট্রিবিউশন কোম্পানি",
    officialUrl: "https://dpdc.org.bd/",
    coverageSourceUrl: "https://www.dpdc.org.bd/notice/other/ToR%20for%20Consultancy%20services%20to%20tender%20and%20monitor%20the%20implementation-FI-WITH%20AUTO-UPDATE%20ATBLE-21.6.2020.pdf",
    coverageNote: "Candidate for Dhaka City Corporation and specified Narayanganj areas; boundaries do not align exactly with thanas.",
  },
  {
    id: "desco",
    shortName: "DESCO",
    name: "Dhaka Electric Supply Company",
    nameBn: "ঢাকা ইলেকট্রিক সাপ্লাই কোম্পানি",
    officialUrl: "https://desco.gov.bd/",
    coverageSourceUrl: "https://powerdivision.gov.bd/pages/static-pages/694032eb35ce18e1c056441d",
    coverageNote: "Candidate only for named DESCO localities such as Mirpur, Gulshan, Uttara, Tongi, and Purbachal.",
  },
  {
    id: "wzpdcl",
    shortName: "WZPDCL",
    name: "West Zone Power Distribution Company",
    nameBn: "ওয়েস্ট জোন পাওয়ার ডিস্ট্রিবিউশন কোম্পানি",
    officialUrl: "https://wzpdcl.gov.bd/",
    coverageSourceUrl: "https://wzpdcl.gov.bd/pages/static-pages/6922dfa1933eb65569e2322b",
    coverageNote: "Candidate only where an official district-headquarters or upazila coverage entry could be matched.",
  },
  {
    id: "nesco",
    shortName: "NESCO",
    name: "Northern Electricity Supply Company",
    nameBn: "নর্দান ইলেকট্রিসিটি সাপ্লাই কোম্পানি",
    officialUrl: "https://nesco.gov.bd/",
    coverageSourceUrl: "https://nesco.gov.bd/pages/static-pages/6922dc9b933eb65569e113aa",
    coverageNote: "Candidate only for the cities and upazilas listed on NESCO's official geographic-area page.",
  },
] as const;

export const locations = rawLocations as unknown as readonly LocationRecord[];

const locationBySlug = new Map(locations.map((location) => [location.slug, location]));
const locationById = new Map(locations.map((location) => [location.id, location]));
const providerById = new Map(providers.map((provider) => [provider.id, provider]));

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function toSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const searchValues = new Map(
  locations.map((location) => {
    const values = [
      location.upazila,
      location.upazilaBn,
      location.district,
      location.districtBn,
      `${location.upazila} ${location.district}`,
      location.upazilaBn && location.districtBn
        ? `${location.upazilaBn} ${location.districtBn}`
        : undefined,
      location.slug,
      ...(location.aliases ?? []),
    ]
      .filter((value): value is string => Boolean(value))
      .map(normalizeSearchValue);
    return [location.id, values] as const;
  }),
);

export function getLocationBySlug(slug: string): LocationRecord | undefined {
  return locationBySlug.get(slug.trim().toLocaleLowerCase("en"));
}

export function getLocationById(id: string): LocationRecord | undefined {
  return locationById.get(id);
}

export function getProvider(id: ProviderId): ProviderDefinition | undefined {
  return providerById.get(id);
}

export function searchLocations(query: string, limit = 20): LocationRecord[] {
  const needle = normalizeSearchValue(query);
  if (!needle || limit <= 0) return [];

  return locations
    .map((location) => {
      const values = searchValues.get(location.id) ?? [];
      const rank = Math.min(
        ...values.map((value) => {
          if (value === needle) return 0;
          if (value.startsWith(needle)) return 1;
          if (value.includes(needle)) return 2;
          return Number.POSITIVE_INFINITY;
        }),
      );
      return { location, rank };
    })
    .filter((result) => Number.isFinite(result.rank))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        Number(right.location.geometryAvailable) - Number(left.location.geometryAvailable) ||
        left.location.upazila.localeCompare(right.location.upazila, "en"),
    )
    .slice(0, limit)
    .map((result) => result.location);
}

const districtMap = new Map<string, DistrictRecord>();
for (const location of locations) {
  const existing = districtMap.get(location.district);
  if (existing) {
    existing.locationCount += 1;
  } else {
    districtMap.set(location.district, {
      name: location.district,
      nameBn: location.districtBn,
      slug: toSlug(location.district),
      locationCount: 1,
    });
  }
}

export const districts: readonly DistrictRecord[] = [...districtMap.values()].sort((left, right) =>
  left.name.localeCompare(right.name, "en"),
);

export function getLocationsByDistrict(district: string): LocationRecord[] {
  const needle = normalizeSearchValue(district);
  return locations.filter(
    (location) =>
      normalizeSearchValue(location.district) === needle ||
      (location.districtBn && normalizeSearchValue(location.districtBn) === needle),
  );
}
