import { mapFeatures } from "@/lib/geo-map";
import { getLocationBySlug, locations, type LocationRecord } from "@/lib/locations";

type MatchedLocation = {
  status: "matched";
  location: LocationRecord;
  approximate: boolean;
};

export type LocationMatch = MatchedLocation | { status: "outside" };

function candidatesForFeature(featureId: string): LocationRecord[] {
  return locations
    .filter((location) => (location.approximateMapFeatureIds ?? []).includes(featureId))
    .sort((left, right) =>
      Number(left.kind === "locality") - Number(right.kind === "locality") ||
      left.upazila.localeCompare(right.upazila, "en"),
    );
}

function resolveFeature(feature: (typeof mapFeatures)[number]): MatchedLocation | null {
  const direct = getLocationBySlug(feature.slug);
  if (direct) return { status: "matched", location: direct, approximate: false };
  const candidates = candidatesForFeature(feature.id);
  if (candidates[0]) {
    return { status: "matched", location: candidates[0], approximate: true };
  }
  return null;
}

function distanceFromFeature(point: DOMPoint, feature: (typeof mapFeatures)[number]): number {
  const [x, y, width, height] = feature.bbox;
  const nearestX = Math.max(x, Math.min(x + width, point.x));
  const nearestY = Math.max(y, Math.min(y + height, point.y));
  const dx = point.x - nearestX;
  const dy = point.y - nearestY;
  const labelDx = point.x - feature.labelPoint[0];
  const labelDy = point.y - feature.labelPoint[1];
  return dx * dx + dy * dy + (labelDx * labelDx + labelDy * labelDy) * 0.0001;
}

export function matchCoordinatesToLocation(longitude: number, latitude: number): LocationMatch {
  const west = 88.016;
  const east = 92.69;
  const south = 20.566;
  const north = 26.635;
  if (longitude < west || longitude > east || latitude < south || latitude > north) {
    return { status: "outside" };
  }

  const availableWidth = 676;
  const availableHeight = 916;
  const meanLatitude = (south + north) / 2;
  const cosLatitude = Math.cos(meanLatitude * Math.PI / 180);
  const scaledWest = west * cosLatitude;
  const scaledEast = east * cosLatitude;
  const scale = Math.min(
    availableWidth / (scaledEast - scaledWest),
    availableHeight / (north - south),
  );
  const contentWidth = (scaledEast - scaledWest) * scale;
  const contentHeight = (north - south) * scale;
  const point = new DOMPoint(
    (720 - contentWidth) / 2 + (longitude * cosLatitude - scaledWest) * scale,
    (960 - contentHeight) / 2 + (north - latitude) * scale,
  );
  const containing = mapFeatures
    .filter((feature) => {
      const path = document.querySelector<SVGPathElement>(`[data-map-feature-id="${feature.id}"]`)
        ?? document.createElementNS("http://www.w3.org/2000/svg", "path");
      if (!path.getAttribute("d")) {
        path.setAttribute("d", feature.path);
        path.setAttribute("fill-rule", "evenodd");
      }
      return path?.isPointInFill(point);
    })
    .sort((left, right) => left.bbox[2] * left.bbox[3] - right.bbox[2] * right.bbox[3]);

  for (const feature of containing) {
    const match = resolveFeature(feature);
    if (match) return match;
  }

  // Coastal gaps, older metro boundaries and low-accuracy device coordinates
  // can fall just outside a polygon. Resolve the nearest catalog-backed feature
  // instead of abandoning a coordinate that is still inside Bangladesh.
  const nearest = [...mapFeatures].sort(
    (left, right) => distanceFromFeature(point, left) - distanceFromFeature(point, right),
  );
  for (const feature of nearest) {
    const match = resolveFeature(feature);
    if (match) return { ...match, approximate: true };
  }

  return { status: "outside" };
}
