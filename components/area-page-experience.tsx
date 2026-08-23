"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AreaSignal } from "@/components/area-signal";
import { LazyBangladeshMap } from "@/components/lazy-bangladesh-map";
import { ArrowIcon } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import {
  emptyAreaSnapshot,
  getAreaSnapshot,
  getMapStatuses,
  recordAnalytics,
  type AreaSnapshot,
  type LiveStateName,
} from "@/lib/client-api";
import type { LocationRecord } from "@/lib/locations";

export function AreaPageExperience({ location }: { location: LocationRecord }) {
  const { locale, text } = useLanguage();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<AreaSnapshot>(() =>
    emptyAreaSnapshot({
      id: location.id,
      slug: location.slug,
      name: location.upazila,
      nameBn: location.upazilaBn,
      districtName: location.district,
      districtNameBn: location.districtBn,
    }),
  );
  const [statuses, setStatuses] = useState<Record<string, LiveStateName>>({});
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const areaName = locale === "bn" && location.upazilaBn ? location.upazilaBn : location.upazila;
  const districtName = locale === "bn" && location.districtBn ? location.districtBn : location.district;

  const refresh = useCallback(async () => {
    setLoading(true);
    const [areaResult, mapResult] = await Promise.allSettled([
      getAreaSnapshot(location.slug),
      getMapStatuses(),
    ]);
    if (areaResult.status === "fulfilled") {
      setSnapshot(areaResult.value);
      setUnavailable(false);
    } else {
      setUnavailable(true);
    }
    if (mapResult.status === "fulfilled") {
      const nextStatuses: Record<string, LiveStateName> = {};
      for (const area of mapResult.value.areas) nextStatuses[area.slug] = area.state;
      setStatuses(nextStatuses);
    }
    setLoading(false);
  }, [location.slug]);

  useEffect(() => {
    void refresh();
    void recordAnalytics("forecast_view", location.id);
    const interval = window.setInterval(() => {
      void refresh();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [location.id, refresh]);

  return (
    <>
      <section className="area-page-hero">
        <div className="area-page-hero__copy">
          <a href="/#live-map" className="area-back-link">
            <ArrowIcon />
            {text.area.back}
          </a>
          <p className="eyebrow">{text.area.reportsOpen}</p>
          <h1>{areaName}</h1>
          <p>{districtName} · {text.area.country}</p>
        </div>
        <div className="area-page-hero__map">
          <LazyBangladeshMap
            compact
            selected={location}
            statuses={statuses}
            onSelect={(nextLocation) => router.push(`/area/${nextLocation.slug}`)}
          />
        </div>
      </section>
      <section className="area-page-signal">
        <AreaSignal
          area={{
            id: location.id,
            slug: location.slug,
            name: location.upazila,
            nameBn: location.upazilaBn,
            districtName: location.district,
            districtNameBn: location.districtBn,
          }}
          loading={loading}
          snapshot={snapshot}
          unavailable={unavailable}
          onRefresh={refresh}
        />

        <div className="official-links">
          <div>
            <p className="eyebrow">{text.area.official}</p>
            <p>{text.area.providerNote}</p>
          </div>
          {snapshot.officialSources.length > 0 ? (
            <div className="official-links__list">
              {snapshot.officialSources.map((source) => (
                <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
                  {source.label}<ArrowIcon />
                </a>
              ))}
            </div>
          ) : (
            <span>{text.area.unknownProvider}</span>
          )}
        </div>
      </section>
    </>
  );
}
