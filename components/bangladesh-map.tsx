"use client";

import { useMemo, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import {
  MAP_ATTRIBUTION,
  MAP_ATTRIBUTION_URL,
  MAP_VIEW_BOX,
  getMapFeaturesForLocation,
  mapFeatures,
} from "@/lib/geo-map";
import { getLocationBySlug, type LocationRecord } from "@/lib/locations";
import type { LiveStateName } from "@/lib/client-api";

export function BangladeshMap({
  selected,
  statuses,
  onSelect,
  compact = false,
}: {
  selected?: LocationRecord | null;
  statuses?: Record<string, LiveStateName>;
  onSelect?: (location: LocationRecord) => void;
  compact?: boolean;
}) {
  const { locale, text } = useLanguage();
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const highlighted = hoveredSlug ? getLocationBySlug(hoveredSlug) : selected ?? null;
  const activeCount = useMemo(
    () => Object.values(statuses ?? {}).filter((state) => state !== "unknown").length,
    [statuses],
  );
  const selectedMapFeatureIds = useMemo(
    () => new Set(selected ? getMapFeaturesForLocation(selected).map((feature) => feature.id) : []),
    [selected],
  );

  const label = highlighted
    ? locale === "bn" && highlighted.upazilaBn
      ? highlighted.upazilaBn
      : highlighted.upazila
    : null;
  const district = highlighted
    ? locale === "bn" && highlighted.districtBn
      ? highlighted.districtBn
      : highlighted.district
    : null;

  return (
    <div className={`bangladesh-map${compact ? " bangladesh-map--compact" : ""}`}>
      <div className="bangladesh-map__topline">
        <span>{text.hero.mapLabel}</span>
        <span>
          <i className="live-dot" />
          {text.hero.mapUpdated}
        </span>
      </div>

      <div className="bangladesh-map__canvas">
        <div className="map-coordinate map-coordinate--north" aria-hidden="true">26°38′N</div>
        <div className="map-coordinate map-coordinate--south" aria-hidden="true">20°34′N</div>
        <div className="map-coordinate map-coordinate--east" aria-hidden="true">92°41′E</div>
        <div className="map-coordinate map-coordinate--west" aria-hidden="true">88°01′E</div>
        <svg
          aria-label={text.map.aria}
          className="bangladesh-map__svg"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          viewBox={MAP_VIEW_BOX}
        >
          <g className="map-grid" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <line key={`v-${index}`} x1={90 + index * 80} x2={90 + index * 80} y1="20" y2="940" />
            ))}
            {Array.from({ length: 11 }, (_, index) => (
              <line key={`h-${index}`} x1="20" x2="700" y1={55 + index * 82} y2={55 + index * 82} />
            ))}
          </g>
          <g className="map-areas">
            {mapFeatures.map((feature) => {
              const state = statuses?.[feature.slug] ?? "unknown";
              const isSelected = selected?.geometryAvailable && selectedMapFeatureIds.has(feature.id);
              const isApproximateCoverage = Boolean(
                selected?.approximateMapFeatureIds?.length && selectedMapFeatureIds.has(feature.id),
              );
              const isDistrictFallback = Boolean(
                selected &&
                  !selected.geometryAvailable &&
                  !selected.approximateMapFeatureIds?.length &&
                  feature.district === selected.district,
              );
              const className = [
                "map-area",
                `map-area--${state}`,
                isSelected ? "is-selected" : "",
                isDistrictFallback || isApproximateCoverage ? "is-district-fallback" : "",
                hoveredSlug === feature.slug ? "is-hovered" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <path
                  className={className}
                  d={feature.path}
                  data-slug={feature.slug}
                  fillRule="evenodd"
                  key={feature.id}
                  onClick={() => {
                    const location = getLocationBySlug(feature.slug);
                    if (location && onSelect) onSelect(location);
                  }}
                  onMouseEnter={() => setHoveredSlug(feature.slug)}
                  onMouseLeave={() => setHoveredSlug(null)}
                />
              );
            })}
          </g>
          {selected?.geometryAvailable ? (
            <g className="selected-ping" aria-hidden="true">
              {(() => {
                const feature = getMapFeaturesForLocation(selected)[0];
                if (!feature) return null;
                return (
                  <>
                    <circle cx={feature.labelPoint[0]} cy={feature.labelPoint[1]} r="11" />
                    <circle cx={feature.labelPoint[0]} cy={feature.labelPoint[1]} r="3" />
                  </>
                );
              })()}
            </g>
          ) : null}
        </svg>
      </div>

      <div className="map-readout" aria-live="polite">
        {highlighted ? (
          <>
            <span>{district}</span>
            <strong>{label}</strong>
            <small>{statuses?.[highlighted.slug] === "appears_out" ? text.status.out : statuses?.[highlighted.slug] === "appears_on" ? text.status.on : text.status.unknown}</small>
          </>
        ) : (
          <>
            <span>{text.map.allAreas}</span>
            <strong>{text.map.country}</strong>
            <small>
              {activeCount > 0
                ? text.map.freshAreas.replace("{count}", String(activeCount))
                : text.status.unknown}
            </small>
          </>
        )}
      </div>

      <div className="map-legend" aria-label={text.map.legend}>
        <span><i className="legend-neutral" />{text.status.unknown}</span>
        <span><i className="legend-on" />{text.status.on}</span>
        <span><i className="legend-out" />{text.status.out}</span>
      </div>
      <a
        className="map-attribution"
        href={MAP_ATTRIBUTION_URL}
        rel="noreferrer"
        target="_blank"
        title={MAP_ATTRIBUTION}
      >
        Boundary data: BBS / OCHA via geoBoundaries · CC BY 3.0 IGO
      </a>
    </div>
  );
}
