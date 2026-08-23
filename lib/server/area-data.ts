import { computeCommunityForecast, type ForecastEvidenceRow } from "@/lib/domain/forecast";
import { allCatalogLocations, districtIdFor } from "@/lib/domain/catalog";
import { isLocationId, locationKey, locationPrecision } from "@/lib/domain/location";
import type {
  LocationKind,
  LocationSelection,
  MapCoverageKind,
} from "@/lib/domain/types";
import { HttpError } from "./http";
import { getLiveState } from "./reports";
import { restRpc, restSelect } from "./supabase-rest";
import { ensureLocationSelection, ensureLocationSlug } from "./catalog-seed";

type DistrictRow = {
  id: string;
  slug: string;
  name_en: string;
  name_bn: string;
  division_name_en: string | null;
  division_name_bn: string | null;
};

type UpazilaRow = {
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
  disable_reason: string | null;
};

type ProviderRow = {
  id: string;
  name_en: string;
  name_bn: string;
  short_name: string;
  official_url: string;
};

type FeederRow = {
  id: string;
  upazila_id: string;
  provider_id: string;
  name_en: string;
  name_bn: string | null;
};

type MappingRow = {
  id: string;
  upazila_id: string;
  provider_id: string;
  source_url: string;
  source_label: string;
  confidence: "confirmed" | "probable" | "unverified";
};

function cleanSearch(value: string | null): string {
  return (value ?? "").normalize("NFKC").trim().toLocaleLowerCase().slice(0, 60);
}

export async function getLocationCatalog(filters: {
  query?: string | null;
  districtId?: string | null;
  upazilaId?: string | null;
  parentId?: string | null;
}): Promise<{
  districts: DistrictRow[];
  upazilas: UpazilaRow[];
  providers: ProviderRow[];
  feeders: FeederRow[];
  mappings: MappingRow[];
}> {
  if (filters.districtId && !isLocationId(filters.districtId)) throw new HttpError(400, "invalid_location", "districtId is invalid.");
  if (filters.upazilaId && !isLocationId(filters.upazilaId)) throw new HttpError(400, "invalid_location", "upazilaId is invalid.");
  if (filters.parentId && !isLocationId(filters.parentId)) throw new HttpError(400, "invalid_location", "parentId is invalid.");
  if (filters.upazilaId) await ensureLocationSelection({ upazilaId: filters.upazilaId });

  const [storedUpazilas, providers, feeders, mappings] = await Promise.all([
    restSelect<UpazilaRow[]>("upazilas", {
      select: "id,district_id,parent_location_id,slug,name_en,name_bn,location_kind,boundary_ref,map_coverage,map_feature_refs,disabled,disable_reason",
      order: "name_en.asc",
    }),
    restSelect<ProviderRow[]>("providers", {
      select: "id,name_en,name_bn,short_name,official_url",
      enabled: "eq.true",
      order: "short_name.asc",
    }),
    filters.upazilaId
      ? restSelect<FeederRow[]>("feeders", {
          select: "id,upazila_id,provider_id,name_en,name_bn",
          upazila_id: `eq.${filters.upazilaId}`,
          active: "eq.true",
          order: "name_en.asc",
        })
      : Promise.resolve([]),
    filters.upazilaId
      ? restSelect<MappingRow[]>("area_provider_mappings", {
          select: "id,upazila_id,provider_id,source_url,source_label,confidence",
          upazila_id: `eq.${filters.upazilaId}`,
          active: "eq.true",
        })
      : Promise.resolve([]),
  ]);

  const storedById = new Map(storedUpazilas.map((area) => [area.id, area]));
  const catalog = allCatalogLocations();
  const districtMap = new Map<string, DistrictRow>();
  for (const location of catalog) {
    const id = districtIdFor(location);
    if (!districtMap.has(id)) {
      districtMap.set(id, {
        id,
        slug: id,
        name_en: location.district,
        name_bn: location.districtBn,
        division_name_en: null,
        division_name_bn: null,
      });
    }
  }
  const districts = [...districtMap.values()].sort((a, b) => a.name_en.localeCompare(b.name_en));
  const mergedById = new Map(storedById);
  for (const location of catalog) {
    if (mergedById.has(location.id)) continue;
    mergedById.set(location.id, {
        id: location.id,
        district_id: districtIdFor(location),
        parent_location_id: location.parentId ?? null,
        slug: location.slug,
        name_en: location.upazila,
        name_bn: location.upazilaBn || location.upazila,
        location_kind: location.kind,
        boundary_ref: location.geometryAvailable ? location.slug : null,
        map_coverage: location.geometryAvailable
          ? "exact"
          : location.approximateMapFeatureIds?.length
            ? "approximate"
            : "district_fallback",
        map_feature_refs: location.geometryAvailable
          ? [location.slug]
          : [...(location.approximateMapFeatureIds ?? [])],
        disabled: false,
        disable_reason: null,
      } satisfies UpazilaRow);
  }
  const allUpazilas: UpazilaRow[] = [...mergedById.values()]
    .filter((location) => !filters.districtId || location.district_id === filters.districtId)
    .filter((location) => !filters.parentId || location.parent_location_id === filters.parentId)
    .sort((a, b) => a.name_en.localeCompare(b.name_en));

  const query = cleanSearch(filters.query ?? null);
  const upazilas = query
    ? allUpazilas.filter((area) =>
        `${area.name_en} ${area.name_bn} ${area.slug}`.normalize("NFKC").toLocaleLowerCase().includes(query),
      )
    : allUpazilas;
  return { districts, upazilas, providers, feeders, mappings };
}

export async function getAreaSnapshot(args: {
  slug: string;
  providerId?: string | null;
  feederId?: string | null;
}): Promise<unknown> {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/i.test(args.slug)) {
    throw new HttpError(404, "area_not_found", "Area not found.");
  }
  if (args.providerId && !isLocationId(args.providerId)) throw new HttpError(400, "invalid_location", "providerId is invalid.");
  if (args.feederId && !isLocationId(args.feederId)) throw new HttpError(400, "invalid_location", "feederId is invalid.");
  if (args.feederId && !args.providerId) throw new HttpError(400, "invalid_location", "A feeder requires a provider.");

  const settings = await restSelect<Array<{ site_kill_switch: boolean; public_message: string | null }>>("app_settings", {
    select: "site_kill_switch,public_message",
    singleton: "eq.true",
    limit: 1,
  });
  if (settings[0]?.site_kill_switch) {
    throw new HttpError(
      503,
      "site_halted",
      settings[0].public_message || "CurrentJabe community data is temporarily unavailable.",
    );
  }

  const catalogArea = await ensureLocationSlug(args.slug);

  const areas = await restSelect<UpazilaRow[]>("upazilas", {
    select: "id,district_id,parent_location_id,slug,name_en,name_bn,location_kind,boundary_ref,map_coverage,map_feature_refs,disabled,disable_reason",
    slug: `eq.${args.slug}`,
    limit: 1,
  });
  const area = areas[0];
  if (!area) throw new HttpError(404, "area_not_found", "Area not found.");

  const selection: LocationSelection = {
    upazilaId: area.id,
    ...(args.providerId ? { providerId: args.providerId } : {}),
    ...(args.feederId ? { feederId: args.feederId } : {}),
  };
  await restRpc("assert_location_scope", {
    p_upazila_id: area.id,
    p_provider_id: args.providerId ?? null,
    p_feeder_id: args.feederId ?? null,
  });
  const since = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
  const [liveState, evidenceRows, officialSources, accuracy] = await Promise.all([
    getLiveState(selection),
    restRpc<ForecastEvidenceRow[]>("get_forecast_evidence", {
      p_upazila_id: area.id,
      p_provider_id: args.providerId ?? null,
      p_feeder_id: args.feederId ?? null,
      p_since: since,
    }),
    restRpc<unknown[]>("get_area_official_sources", {
      p_upazila_id: area.id,
      p_provider_id: args.providerId ?? null,
    }),
    restRpc<{ evaluated_count: number; accuracy: number | null }>("get_forecast_accuracy", {
      p_location_key: locationKey(selection),
    }),
  ]);
  const forecast = computeCommunityForecast(evidenceRows);
  const publicForecast = {
    ...forecast,
    strength: forecast.eligible ? forecast.strength : null,
    evidence: {
      ...forecast.evidence,
      independentContributors: forecast.evidence.contributorCount,
      timedEvents: forecast.evidence.timedEventCount,
      distinctDays: forecast.evidence.distinctDayCount,
      hasRecentEvidence:
        forecast.evidence.newestEventAt !== null &&
        Date.parse(forecast.evidence.newestEventAt) >= Date.now() - 7 * 24 * 60 * 60 * 1000,
    },
  };
  const publicSources = (officialSources as Array<Record<string, unknown>>).map((source) => ({
    label: String(source.mapping_source_label ?? source.provider_short_name ?? "Official provider source"),
    url: String(source.mapping_source_url ?? source.official_url ?? ""),
    providerId: source.provider_id,
    providerNameEn: source.provider_name_en,
    providerNameBn: source.provider_name_bn,
    confidence: source.confidence,
    sourceVerifiedAt: source.source_verified_at,
  }));

  if (forecast.eligible) {
    try {
      await restRpc("log_forecast_run", {
        p_location_key: locationKey(selection),
        p_precision: locationPrecision(selection),
        p_upazila_id: area.id,
        p_provider_id: args.providerId ?? null,
        p_feeder_id: args.feederId ?? null,
        p_forecast: forecast,
      });
    } catch (error) {
      // A logging failure must not hide a forecast that was computed from valid
      // evidence; it only delays future accuracy publication.
      console.warn("Could not log forecast run", error);
    }
  }

  return {
    area: {
      id: area.id,
      districtId: area.district_id,
      slug: area.slug,
      name: area.name_en,
      nameEn: area.name_en,
      nameBn: area.name_bn,
      districtName: catalogArea.district,
      districtNameBn: catalogArea.districtBn,
      kind: area.location_kind,
      parentLocationId: area.parent_location_id,
      boundaryRef: area.boundary_ref,
      mapCoverage: area.map_coverage,
      mapFeatureRefs: area.map_feature_refs,
      disabled: area.disabled,
      disableReason: area.disable_reason,
    },
    selection: { ...selection, precision: locationPrecision(selection) },
    liveState,
    forecast: publicForecast,
    accuracy:
      Number(accuracy.evaluated_count ?? 0) >= 20 && accuracy.accuracy !== null
        ? Number(accuracy.accuracy)
        : null,
    accuracyEvidence:
      Number(accuracy.evaluated_count ?? 0) >= 20
        ? { evaluatedForecasts: Number(accuracy.evaluated_count) }
        : null,
    officialSources: publicSources,
  };
}

export function getMapStatus(): Promise<unknown> {
  return restRpc("get_map_status", {});
}
