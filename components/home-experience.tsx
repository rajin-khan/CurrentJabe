"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AreaSignal } from "@/components/area-signal";
import { LazyBangladeshMap } from "@/components/lazy-bangladesh-map";
import { useLanguage } from "@/components/language-provider";
import { LocationSearch } from "@/components/location-search";
import {
  emptyAreaSnapshot,
  getAreaSnapshot,
  getMapStatuses,
  recordAnalytics,
  type AreaSnapshot,
  type LiveStateName,
} from "@/lib/client-api";
import { getDhakaDate } from "@/lib/dhaka-date";
import type { LocationRecord } from "@/lib/locations";
import {
  readRememberedReportArea,
  rememberReportArea,
} from "@/lib/report-memory";

function toReportArea(location: LocationRecord) {
  return {
    id: location.id,
    slug: location.slug,
    name: location.upazila,
    nameBn: location.upazilaBn,
    districtName: location.district,
    districtNameBn: location.districtBn,
  };
}

export function HomeExperience() {
  const { text } = useLanguage();
  const [titleBeforeHighlight, titleAfterHighlight = ""] = text.hero.title.split(
    text.hero.titleHighlight,
  );
  const [selected, setSelected] = useState<LocationRecord | null>(null);
  const [snapshot, setSnapshot] = useState<AreaSnapshot | null>(null);
  const [loadingArea, setLoadingArea] = useState(false);
  const [areaUnavailable, setAreaUnavailable] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, LiveStateName>>({});
  const resultRef = useRef<HTMLElement>(null);
  const areaRequestRef = useRef(0);

  const scrollToAreaResult = useCallback(() => {
    window.setTimeout(() => {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      resultRef.current?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }, 120);
  }, []);

  const refreshStatuses = useCallback(async () => {
    try {
      const response = await getMapStatuses();
      const statusMap: Record<string, LiveStateName> = {};
      for (const area of response.areas) statusMap[area.slug] = area.state;
      setStatuses(statusMap);
    } catch {
      // Preserve the last known map instead of turning a service outage into fake silence.
    }
  }, []);

  const refreshArea = useCallback(async (
    location: LocationRecord,
    options: { silent?: boolean } = {},
  ): Promise<AreaSnapshot | null> => {
    const requestId = ++areaRequestRef.current;
    if (!options.silent) setLoadingArea(true);
    try {
      const response = await getAreaSnapshot(location.slug);
      if (requestId === areaRequestRef.current) {
        setSnapshot(response);
        setAreaUnavailable(false);
      }
      return response;
    } catch {
      if (requestId === areaRequestRef.current && !options.silent) setAreaUnavailable(true);
      return null;
    } finally {
      if (requestId === areaRequestRef.current && !options.silent) setLoadingArea(false);
    }
  }, []);

  const selectLocation = useCallback(
    (location: LocationRecord, revealDetails = false, restoring = false) => {
      setSelected(location);
      rememberReportArea(getDhakaDate(), location);
      setSnapshot(
        emptyAreaSnapshot({
          id: location.id,
          slug: location.slug,
          name: location.upazila,
          nameBn: location.upazilaBn,
          districtName: location.district,
          districtNameBn: location.districtBn,
        }),
      );
      setAreaUnavailable(false);
      void refreshArea(location);
      if (!restoring) void recordAnalytics("area_search", location.id);
      if (!restoring && (revealDetails || window.matchMedia("(max-width: 860px)").matches)) {
        scrollToAreaResult();
      }
    },
    [refreshArea, scrollToAreaResult],
  );

  const openLocationDetails = useCallback(
    (location: LocationRecord) => {
      if (selected?.id === location.id) {
        scrollToAreaResult();
        return;
      }
      selectLocation(location, true);
    },
    [scrollToAreaResult, selectLocation, selected?.id],
  );

  useEffect(() => {
    const remembered = readRememberedReportArea(getDhakaDate());
    if (remembered) selectLocation(remembered, false, true);
  }, [selectLocation]);

  useEffect(() => {
    void refreshStatuses();
    void recordAnalytics("return_visit");
    const interval = window.setInterval(refreshStatuses, 60_000);
    return () => window.clearInterval(interval);
  }, [refreshStatuses]);

  useEffect(() => {
    if (!selected) return;
    const interval = window.setInterval(() => {
      void refreshArea(selected, { silent: true });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [refreshArea, selected]);

  return (
    <>
      <section className="hero" id="live-map">
        <div className="hero__copy">
          <p className="eyebrow">{text.hero.eyebrow}</p>
          <h1>
            {titleBeforeHighlight}
            <span className="hero__title-highlight">{text.hero.titleHighlight}</span>
            {titleAfterHighlight}
            {text.hero.titleAccent ? <em>{text.hero.titleAccent}</em> : null}
          </h1>
          <p className="hero__description">{text.hero.description}</p>
          <ul className="hero__value-list" aria-label={text.hero.valueLabel}>
            <li>
              <span aria-hidden="true">{text.hero.liveValueNumber}</span>
              <div>
                <strong>{text.hero.liveValueTitle}</strong>
                <small>{text.hero.liveValueBody}</small>
              </div>
            </li>
            <li>
              <span aria-hidden="true">{text.hero.forecastValueNumber}</span>
              <div>
                <strong>{text.hero.forecastValueTitle}</strong>
                <small>{text.hero.forecastValueBody}</small>
              </div>
            </li>
          </ul>
          <LocationSearch selected={selected} onSelect={selectLocation} />
        </div>
        <div className="hero__map">
          <LazyBangladeshMap
            onOpenDetails={openLocationDetails}
            onSelect={selectLocation}
            selected={selected}
            statuses={statuses}
          />
        </div>
      </section>

      {selected && snapshot ? (
        <section className="area-result" ref={resultRef}>
          <div className="area-result__heading">
            <p className="eyebrow">{text.hero.selected}</p>
            <span>{text.hero.selectedDetail}</span>
          </div>
          <AreaSignal
            area={toReportArea(selected)}
            loading={loadingArea}
            snapshot={snapshot}
            unavailable={areaUnavailable}
            onRefresh={async () => {
              await refreshArea(selected, { silent: true });
              void refreshStatuses();
            }}
          />
        </section>
      ) : null}
    </>
  );
}
