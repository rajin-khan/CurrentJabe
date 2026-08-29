import { mapFeatures } from "@/lib/geo-map";
import { getLocationBySlug, locations, type LocationRecord } from "@/lib/locations";

export type LocationMatch =
  | { status: "matched"; location: LocationRecord }
  | { status: "outside" | "ambiguous" };

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
  const direct = containing.map((feature) => getLocationBySlug(feature.slug)).find(Boolean);
  const approximateCandidates = direct ? [] : locations.filter((location) =>
    (location.approximateMapFeatureIds ?? []).some((id) =>
      containing.some((feature) => feature.id === id)),
  );
  const match = direct ?? (approximateCandidates.length === 1 ? approximateCandidates[0] : null);
  return match ? { status: "matched", location: match } : { status: "ambiguous" };
}
