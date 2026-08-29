"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import {
  MAP_ATTRIBUTION,
  MAP_ATTRIBUTION_URL,
  MAP_VIEW_BOX_DIMENSIONS,
  getMapFeaturesForLocation,
  mapFeatures,
} from "@/lib/geo-map";
import { getLocationBySlug, type LocationRecord } from "@/lib/locations";
import type { LiveStateName } from "@/lib/client-api";

export function BangladeshMap({
  selected,
  statuses,
  onSelect,
  onOpenDetails,
  compact = false,
}: {
  selected?: LocationRecord | null;
  statuses?: Record<string, LiveStateName>;
  onSelect?: (location: LocationRecord) => void;
  onOpenDetails?: (location: LocationRecord) => void;
  compact?: boolean;
}) {
  const { locale, text } = useLanguage();
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState<number[]>([...MAP_VIEW_BOX_DIMENSIONS]);
  const [showFullMap, setShowFullMap] = useState(false);
  const animationRef = useRef<number | null>(null);
  const hovered = hoveredSlug ? getLocationBySlug(hoveredSlug) : null;
  const highlighted = hovered ?? selected ?? null;
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
    : "";
  const district = highlighted
    ? locale === "bn" && highlighted.districtBn
      ? highlighted.districtBn
      : highlighted.district
    : "";
  const openDetails = onOpenDetails ?? onSelect;

  const targetViewBox = useMemo(() => {
    if (!selected || showFullMap) return [...MAP_VIEW_BOX_DIMENSIONS];
    let features = [...getMapFeaturesForLocation(selected)];
    if (features.length === 0) {
      features = mapFeatures.filter((feature) => feature.district === selected.district);
    }
    if (features.length === 0) return [...MAP_VIEW_BOX_DIMENSIONS];
    const minX = Math.min(...features.map((feature) => feature.bbox[0]));
    const minY = Math.min(...features.map((feature) => feature.bbox[1]));
    const maxX = Math.max(...features.map((feature) => feature.bbox[0] + feature.bbox[2]));
    const maxY = Math.max(...features.map((feature) => feature.bbox[1] + feature.bbox[3]));
    const fullAspect = MAP_VIEW_BOX_DIMENSIONS[2] / MAP_VIEW_BOX_DIMENSIONS[3];
    let width = Math.max(120, (maxX - minX) * 1.7);
    let height = Math.max(160, (maxY - minY) * 1.7);
    if (width / height > fullAspect) height = width / fullAspect;
    else width = height * fullAspect;
    width = Math.min(MAP_VIEW_BOX_DIMENSIONS[2], width);
    height = Math.min(MAP_VIEW_BOX_DIMENSIONS[3], height);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    return [
      Math.max(0, Math.min(MAP_VIEW_BOX_DIMENSIONS[2] - width, centerX - width / 2)),
      Math.max(0, Math.min(MAP_VIEW_BOX_DIMENSIONS[3] - height, centerY - height / 2)),
      width,
      height,
    ];
  }, [selected, showFullMap]);

  useEffect(() => setShowFullMap(false), [selected?.id]);

  useEffect(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setViewBox(targetViewBox);
      return;
    }
    const from = [...viewBox];
    const startedAt = performance.now();
    const duration = 720;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setViewBox(from.map((value, index) => value + (targetViewBox[index] - value) * eased));
      if (progress < 1) animationRef.current = requestAnimationFrame(tick);
      else animationRef.current = null;
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
    // The current camera is intentionally captured only when a new target begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetViewBox]);

  return (
    <div
      className={`bangladesh-map${compact ? " bangladesh-map--compact" : ""}`}
      onPointerLeave={() => setHoveredSlug(null)}
    >
      <div className="bangladesh-map__topline">
        <span>{text.hero.mapLabel}</span>
        <div className="map-tools">
          {selected ? (
            <button type="button" onClick={() => setShowFullMap(true)}>
              {locale === "bn" ? "পুরো মানচিত্র" : "Full map"}
            </button>
          ) : null}
        </div>
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
          viewBox={viewBox.join(" ")}
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
              const featureLocation = getLocationBySlug(feature.slug);
              const hoverSlug = featureLocation?.slug ?? null;
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
                  data-map-feature-id={feature.id}
                  data-slug={feature.slug}
                  fillRule="evenodd"
                  key={feature.id}
                  onClick={() => {
                    setHoveredSlug(hoverSlug);
                    if (featureLocation) onSelect?.(featureLocation);
                  }}
                  onMouseEnter={() => setHoveredSlug(hoverSlug)}
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
            {openDetails ? (
              <button
                aria-label={text.map.viewDetails.replace("{area}", label)}
                className="map-readout__location"
                onClick={() => {
                  setHoveredSlug(null);
                  openDetails(highlighted);
                }}
                type="button"
              >
                {label}
              </button>
            ) : (
              <strong>{label}</strong>
            )}
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
