"use client";

import type { LocationRecord } from "@/lib/locations";

const STORAGE_KEY = "currentjabe-report-memory-v1";

type RememberedArea = {
  dhakaDate: string;
  location: LocationRecord;
};

function isRememberedArea(value: unknown): value is RememberedArea {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RememberedArea>;
  const location = candidate.location as Partial<LocationRecord> | undefined;
  return Boolean(
    typeof candidate.dhakaDate === "string" &&
      location &&
      typeof location.id === "string" &&
      typeof location.slug === "string" &&
      typeof location.district === "string" &&
      typeof location.upazila === "string" &&
      typeof location.kind === "string",
  );
}

export function rememberReportArea(dhakaDate: string, location: LocationRecord): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ dhakaDate, location } satisfies RememberedArea),
    );
  } catch {
    // Reporting still works when storage is disabled or full.
  }
}

export function readRememberedReportArea(dhakaDate: string): LocationRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRememberedArea(parsed) || parsed.dhakaDate !== dhakaDate) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.location;
  } catch {
    return null;
  }
}

export function clearReportMemory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // There may be no usable browser storage to clear.
  }
}
