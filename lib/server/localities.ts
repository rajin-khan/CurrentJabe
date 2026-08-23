import "server-only";

import {
  allCatalogLocations,
  browseAliasLocationIdsFor,
  browseParentIdFor,
  catalogLocationById,
  catalogLocationBySlug,
  type CatalogLocation,
} from "@/lib/domain/catalog";
import {
  localitySlugPart,
  normalizedLocationName,
  parentRelativeNormalizedLocationName,
  type CanonicalLocalityName,
} from "@/lib/domain/locality";
import { isLocationId } from "@/lib/domain/location";
import type { LocationKind, MapCoverageKind } from "@/lib/domain/types";
import type { LocationRecord, ProviderId } from "@/lib/locations";
import { HttpError } from "./http";
import { ensureLocationSelection } from "./catalog-seed";
import { restRpc, restSelect } from "./supabase-rest";

type LocalityRow = {
  id: string;
  district_id: string;
  parent_location_id: string | null;
  slug: string;
  name_en: string;
  name_bn: string;
  location_kind: LocationKind;
  boundary_ref: string | null;
  map_coverage: MapCoverageKind;
  map_feature_refs: string[];
  disabled: boolean;
  origin?: "catalog" | "community" | "admin";
  normalized_name?: string | null;
};

type DistrictRow = {
  id: string;
  name_en: string;
  name_bn: string;
};

type CreateLocalityResult = {
  created: boolean;
  locality: LocalityRow;
};

const LOCALITY_SELECT = [
  "id",
  "district_id",
  "parent_location_id",
  "slug",
  "name_en",
  "name_bn",
  "location_kind",
  "boundary_ref",
  "map_coverage",
  "map_feature_refs",
  "disabled",
  "origin",
  "normalized_name",
].join(",");

function rowToLocation(row: LocalityRow, district: DistrictRow): LocationRecord {
  return {
    id: row.id,
    slug: row.slug,
    district: district.name_en,
    districtBn: district.name_bn,
    upazila: row.name_en,
    upazilaBn: row.name_bn,
    providerHints: [] as ProviderId[],
    kind: row.location_kind,
    ...(row.parent_location_id ? { parentId: row.parent_location_id } : {}),
    geometryAvailable: Boolean(row.boundary_ref && row.map_coverage === "exact"),
    ...(row.map_coverage === "approximate"
      ? { approximateMapFeatureIds: row.map_feature_refs }
      : {}),
    mapCoverage: row.map_coverage,
    origin: row.origin ?? "community",
    communityAdded: row.origin === "community" || row.origin === undefined,
  };
}

function catalogToLocation(location: CatalogLocation): LocationRecord {
  return {
    id: location.id,
    slug: location.slug,
    district: location.district,
    districtBn: location.districtBn,
    upazila: location.upazila,
    ...(location.upazilaBn ? { upazilaBn: location.upazilaBn } : {}),
    providerHints: location.providerHints as ProviderId[],
    ...(location.providerMappings
      ? {
          providerMappings: location.providerMappings.map((mapping) => ({
            ...mapping,
            providerId: mapping.providerId as ProviderId,
          })),
        }
      : {}),
    kind: location.kind,
    ...(location.parentId ? { parentId: location.parentId } : {}),
    geometryAvailable: location.geometryAvailable,
    ...(location.approximateMapFeatureIds
      ? { approximateMapFeatureIds: location.approximateMapFeatureIds }
      : {}),
    ...(location.mapCoverage ? { mapCoverage: location.mapCoverage } : {}),
    ...(location.aliases ? { aliases: location.aliases } : {}),
    origin: "catalog",
    communityAdded: false,
  };
}

export async function resolvePublicLocation(slug: string): Promise<LocationRecord> {
  const bundled = catalogLocationBySlug(slug);
  if (bundled) return catalogToLocation(bundled);

  const rows = await restSelect<LocalityRow[]>("upazilas", {
    select: LOCALITY_SELECT,
    slug: `eq.${slug}`,
    limit: 1,
  });
  const row = rows[0];
  if (!row || row.disabled) {
    throw new HttpError(404, "area_not_found", "Area not found.");
  }
  const districts = await restSelect<DistrictRow[]>("districts", {
    select: "id,name_en,name_bn",
    id: `eq.${row.district_id}`,
    limit: 1,
  });
  if (!districts[0]) throw new HttpError(404, "area_not_found", "Area district not found.");
  return rowToLocation(row, districts[0]);
}

async function getParentAndDistrict(parentId: string): Promise<{
  parent: LocalityRow;
  district: DistrictRow;
}> {
  const parents = await restSelect<LocalityRow[]>("upazilas", {
    select: LOCALITY_SELECT,
    id: `eq.${parentId}`,
    limit: 1,
  });
  const parent = parents[0];
  if (!parent || parent.disabled || parent.location_kind === "locality") {
    throw new HttpError(400, "invalid_parent_location", "Choose a valid thana or upazila first.");
  }
  const districts = await restSelect<DistrictRow[]>("districts", {
    select: "id,name_en,name_bn",
    id: `eq.${parent.district_id}`,
    limit: 1,
  });
  if (!districts[0]) throw new HttpError(400, "invalid_parent_location", "The parent district is unavailable.");
  return { parent, district: districts[0] };
}

export async function getLocalities(parentId: string): Promise<LocationRecord[]> {
  if (!isLocationId(parentId)) {
    throw new HttpError(400, "invalid_parent_location", "Choose a valid thana or upazila first.");
  }
  await ensureLocationSelection({ upazilaId: parentId });
  const { district } = await getParentAndDistrict(parentId);
  const stored = await restSelect<LocalityRow[]>("upazilas", {
    select: LOCALITY_SELECT,
    parent_location_id: `eq.${parentId}`,
    location_kind: "eq.locality",
    disabled: "eq.false",
    order: "name_en.asc",
    limit: 400,
  });
  const aliasIds = browseAliasLocationIdsFor(parentId);
  const storedAliases = aliasIds.length > 0
    ? await restSelect<LocalityRow[]>("upazilas", {
        select: LOCALITY_SELECT,
        id: `in.(${aliasIds.join(",")})`,
        location_kind: "eq.locality",
        disabled: "eq.false",
        limit: 20,
      })
    : [];

  const merged = new Map<string, LocationRecord>();
  for (const location of allCatalogLocations()) {
    if (location.kind === "locality" && browseParentIdFor(location) === parentId) {
      merged.set(location.id, catalogToLocation(location));
    }
  }
  for (const row of [...stored, ...storedAliases]) merged.set(row.id, rowToLocation(row, district));
  return [...merged.values()].sort((left, right) =>
    left.upazila.localeCompare(right.upazila, "en"),
  );
}

export async function createCommunityLocality(args: {
  parentId: string;
  inputLocale: "en" | "bn" | "und";
  name: CanonicalLocalityName;
  visitorHash: string;
  ipHash: string;
}): Promise<{ location: LocationRecord; created: boolean }> {
  await ensureLocationSelection({ upazilaId: args.parentId });
  const { parent, district } = await getParentAndDistrict(args.parentId);
  const relativeNormalizedName = parentRelativeNormalizedLocationName(
    args.name.displayName,
    parent.name_en,
    parent.name_bn,
  );

  if (
    normalizedLocationName(parent.name_en) === args.name.normalizedName ||
    normalizedLocationName(parent.name_bn) === args.name.normalizedName
  ) {
    const bundledParent = catalogLocationById(parent.id);
    return {
      location: bundledParent ? catalogToLocation(bundledParent) : rowToLocation(parent, district),
      created: false,
    };
  }

  const existingLocality = (await getLocalities(parent.id)).find((location) =>
    parentRelativeNormalizedLocationName(
      location.upazila,
      parent.name_en,
      parent.name_bn,
    ) === relativeNormalizedName ||
    (location.upazilaBn
      ? parentRelativeNormalizedLocationName(
          location.upazilaBn,
          parent.name_en,
          parent.name_bn,
        ) === relativeNormalizedName
      : false) ||
    (location.aliases ?? []).some(
      (alias) => parentRelativeNormalizedLocationName(
        alias,
        parent.name_en,
        parent.name_bn,
      ) === relativeNormalizedName,
    ),
  );
  if (existingLocality) return { location: existingLocality, created: false };

  const result = await restRpc<CreateLocalityResult>("api_create_community_locality", {
    p_parent_location_id: parent.id,
    p_display_name: args.name.displayName,
    p_normalized_name: relativeNormalizedName,
    p_slug_part: localitySlugPart(args.name.displayName, parent.name_en),
    p_input_locale: args.inputLocale,
    p_visitor_hash: args.visitorHash,
    p_ip_hash: args.ipHash,
  });
  if (!result?.locality) {
    throw new HttpError(502, "locality_creation_failed", "The area could not be added.");
  }
  return {
    location: rowToLocation(result.locality, district),
    created: Boolean(result.created),
  };
}
