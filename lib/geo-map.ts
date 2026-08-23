import rawMap from "@/data/map-paths.json";

import type { LocationRecord } from "@/lib/locations";

export interface MapFeature {
  id: string;
  slug: string;
  district: string;
  path: string;
  bbox: readonly [x: number, y: number, width: number, height: number];
  labelPoint: readonly [x: number, y: number];
}

interface MapDataset {
  viewBox: readonly [minX: number, minY: number, width: number, height: number];
  features: readonly MapFeature[];
}

const mapDataset = rawMap as unknown as MapDataset;

export const MAP_VIEW_BOX_DIMENSIONS = mapDataset.viewBox;
export const MAP_VIEW_BOX = mapDataset.viewBox.join(" ");
export const MAP_ATTRIBUTION =
  "Administrative boundaries: Bangladesh Bureau of Statistics (BBS) and OCHA ROAP, distributed via geoBoundaries; CC BY 3.0 IGO.";
export const MAP_ATTRIBUTION_URL = "https://www.geoboundaries.org/";
export const mapFeatures = mapDataset.features;

const mapFeatureById = new Map(mapFeatures.map((feature) => [feature.id, feature]));
const mapFeatureBySlug = new Map(mapFeatures.map((feature) => [feature.slug, feature]));
const mapFeaturesByDistrict = new Map<string, MapFeature[]>();
for (const feature of mapFeatures) {
  const districtFeatures = mapFeaturesByDistrict.get(feature.district) ?? [];
  districtFeatures.push(feature);
  mapFeaturesByDistrict.set(feature.district, districtFeatures);
}

export function getMapFeature(idOrSlug: string): MapFeature | undefined {
  return mapFeatureById.get(idOrSlug) ?? mapFeatureBySlug.get(idOrSlug);
}

export function getMapFeatureForLocation(location: LocationRecord): MapFeature | undefined {
  return mapFeatureById.get(location.id);
}

/**
 * Returns only sourced visual coverage. Localities can reference multiple
 * administrative features as an explicitly approximate orientation aid.
 */
export function getMapFeaturesForLocation(location: LocationRecord): readonly MapFeature[] {
  if (location.geometryAvailable) {
    const feature = mapFeatureById.get(location.id);
    return feature ? [feature] : [];
  }
  return (location.approximateMapFeatureIds ?? []).flatMap((id) => {
    const feature = mapFeatureById.get(id);
    return feature ? [feature] : [];
  });
}

/** Useful as an honest visual fallback for a newer upazila without a polygon. */
export function getMapFeaturesByDistrict(district: string): readonly MapFeature[] {
  return mapFeaturesByDistrict.get(district) ?? [];
}
