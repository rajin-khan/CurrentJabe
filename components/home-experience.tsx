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
import type { LocationRecord } from "@/lib/locations";

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
    (location: LocationRecord) => {
      setSelected(location);
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
      void recordAnalytics("area_search", location.id);
      window.setTimeout(() => {
        if (window.matchMedia("(max-width: 860px)").matches) {
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 120);
    },
    [refreshArea],
  );

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
          <LocationSearch selected={selected} onSelect={selectLocation} />
        </div>
        <div className="hero__map">
          <LazyBangladeshMap selected={selected} statuses={statuses} onSelect={selectLocation} />
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
