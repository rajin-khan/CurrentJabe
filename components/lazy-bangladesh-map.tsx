"use client";

import dynamic from "next/dynamic";
import type { LiveStateName } from "@/lib/client-api";
import type { LocationRecord } from "@/lib/locations";

const BangladeshMap = dynamic(
  () => import("@/components/bangladesh-map").then((module) => module.BangladeshMap),
  {
    ssr: false,
    loading: () => (
      <div className="bangladesh-map map-placeholder" role="status" aria-label="Loading Bangladesh map">
        <span />
      </div>
    ),
  },
);

export function LazyBangladeshMap({
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
  return (
    <BangladeshMap
      compact={compact}
      onSelect={onSelect}
      selected={selected}
      statuses={statuses}
    />
  );
}
