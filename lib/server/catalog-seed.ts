import {
  assertCatalogSelection,
  catalogLocationById,
  catalogLocationBySlug,
  districtIdFor,
  type CatalogLocation,
} from "@/lib/domain/catalog";
import type { LocationSelection } from "@/lib/domain/types";
import { HttpError } from "./http";
import { restInsertIgnore, restSelect } from "./supabase-rest";

type StoredLocationRow = {
  id: string;
  district_id: string;
  parent_location_id: string | null;
  slug: string;
  name_en: string;
  name_bn: string;
  location_kind: CatalogLocation["kind"];
  boundary_ref: string | null;
  map_coverage: NonNullable<CatalogLocation["mapCoverage"]>;
  map_feature_refs: string[];
  disabled: boolean;
};

type StoredDistrictRow = {
  id: string;
  name_en: string;
  name_bn: string;
};

const PROVIDER_COVERAGE_SOURCES: Record<string, string> = {
  dpdc: "https://www.dpdc.org.bd/notice/other/ToR%20for%20Consultancy%20services%20to%20tender%20and%20monitor%20the%20implementation-FI-WITH%20AUTO-UPDATE%20ATBLE-21.6.2020.pdf",
  desco: "https://powerdivision.gov.bd/pages/static-pages/694032eb35ce18e1c056441d",
  wzpdcl: "https://wzpdcl.gov.bd/pages/static-pages/6922dfa1933eb65569e2322b",
  nesco: "https://nesco.gov.bd/pages/static-pages/6922dc9b933eb65569e113aa",
};

async function seedCatalogLocation(
  location: CatalogLocation,
  seeded = new Set<string>(),
): Promise<void> {
  if (seeded.has(location.id)) return;
  seeded.add(location.id);

  if (location.parentId) {
    const parent = catalogLocationById(location.parentId);
    if (!parent) throw new Error(`Catalog parent ${location.parentId} was not found.`);
    await seedCatalogLocation(parent, seeded);
  }

  const districtId = districtIdFor(location);
  await restInsertIgnore("districts", {
    id: districtId,
    slug: districtId,
    name_en: location.district,
    name_bn: location.districtBn,
  });
  await restInsertIgnore("upazilas", {
    id: location.id,
    district_id: districtId,
    slug: location.slug,
    name_en: location.upazila,
    name_bn: location.upazilaBn || location.upazila,
    boundary_ref: location.geometryAvailable ? location.slug : null,
    location_kind: location.kind,
    parent_location_id: location.parentId ?? null,
    map_coverage: location.geometryAvailable
      ? "exact"
      : location.approximateMapFeatureIds?.length
        ? "approximate"
        : "district_fallback",
    map_feature_refs: location.geometryAvailable
      ? [location.slug]
      : (location.approximateMapFeatureIds ?? []),
  });
  const explicitMappings = location.providerMappings ?? [];
  const explicitProviderIds = new Set(explicitMappings.map((mapping) => mapping.providerId));
  const mappings = [
    ...explicitMappings.map((mapping) => ({
      upazila_id: location.id,
      provider_id: mapping.providerId,
      source_url: mapping.sourceUrl,
      source_label: mapping.sourceLabel,
      confidence: mapping.confidence,
      active: true,
    })),
    ...location.providerHints.flatMap((providerId) => {
      if (explicitProviderIds.has(providerId)) return [];
      const sourceUrl = PROVIDER_COVERAGE_SOURCES[providerId];
      return sourceUrl
        ? [{
            upazila_id: location.id,
            provider_id: providerId,
            source_url: sourceUrl,
            source_label: "Official coverage source matched by the bundled location catalog",
            confidence: "probable",
            active: true,
          }]
        : [];
    }),
  ];
  if (mappings.length > 0) {
    await restInsertIgnore(
      "area_provider_mappings",
      mappings,
      ["upazila_id", "provider_id"],
    );
  }
}

export async function ensureLocationSelection(selection: LocationSelection): Promise<void> {
  const bundled = catalogLocationById(selection.upazilaId);
  if (bundled) {
    let location: CatalogLocation;
    try {
      location = assertCatalogSelection(selection);
    } catch {
      throw new HttpError(400, "invalid_location", "The selected area is not valid.");
    }
    await seedCatalogLocation(location);
    return;
  }

  const stored = await restSelect<StoredLocationRow[]>("upazilas", {
    select: "id,district_id,parent_location_id,slug,name_en,name_bn,location_kind,boundary_ref,map_coverage,map_feature_refs,disabled",
    id: `eq.${selection.upazilaId}`,
    limit: 1,
  });
  const location = stored[0];
  if (!location) {
    throw new HttpError(400, "invalid_location", "The selected area does not exist.");
  }
  if (location.disabled) {
    throw new HttpError(423, "area_disabled", "Community reporting is unavailable for this area.");
  }
  if (selection.districtId && selection.districtId !== location.district_id) {
    throw new HttpError(400, "invalid_location", "The selected area is not in that district.");
  }
}

export async function ensureLocationSlug(slug: string): Promise<CatalogLocation> {
  const bundled = catalogLocationBySlug(slug);
  if (bundled) {
    await seedCatalogLocation(bundled);
    return bundled;
  }

  const stored = await restSelect<StoredLocationRow[]>("upazilas", {
    select: "id,district_id,parent_location_id,slug,name_en,name_bn,location_kind,boundary_ref,map_coverage,map_feature_refs,disabled",
    slug: `eq.${slug}`,
    limit: 1,
  });
  const location = stored[0];
  if (!location || location.disabled) {
    throw new HttpError(404, "area_not_found", "Area not found.");
  }
  const districts = await restSelect<StoredDistrictRow[]>("districts", {
    select: "id,name_en,name_bn",
    id: `eq.${location.district_id}`,
    limit: 1,
  });
  const district = districts[0];
  if (!district) throw new HttpError(404, "area_not_found", "Area district not found.");

  return {
    id: location.id,
    slug: location.slug,
    district: district.name_en,
    districtBn: district.name_bn,
    upazila: location.name_en,
    upazilaBn: location.name_bn,
    providerHints: [],
    kind: location.location_kind,
    ...(location.parent_location_id ? { parentId: location.parent_location_id } : {}),
    geometryAvailable: Boolean(location.boundary_ref && location.map_coverage === "exact"),
    approximateMapFeatureIds:
      location.map_coverage === "approximate" ? location.map_feature_refs : [],
    mapCoverage: location.map_coverage,
  };
}
