import type { LocationKind, MapCoverageKind } from "@/lib/domain/types";
import type { LocationRecord } from "@/lib/locations";

export type LiveStateName = "unknown" | "appears_on" | "appears_out";

export type LiveState = {
  state: LiveStateName;
  contributorCount: number;
  recentContributorCount: number;
  onContributorCount: number;
  outContributorCount: number;
  leadingState: "on" | "out" | null;
  observedAt: string | null;
  expiresAt: string | null;
  precision: string | null;
};

export type ForecastWindow = {
  startsAt: string;
  endsAt: string;
  localStartHour: number;
  score: number;
};

export type AreaSnapshot = {
  area: {
    id: string;
    slug: string;
    name: string;
    nameBn?: string | null;
    districtName?: string | null;
    districtNameBn?: string | null;
    kind?: LocationKind;
    parentLocationId?: string | null;
    mapCoverage?: MapCoverageKind;
    mapFeatureRefs?: string[];
  };
  selection: {
    providerId?: string | null;
    feederId?: string | null;
    precision?: string | null;
  };
  liveState: LiveState;
  forecast: {
    eligible: boolean;
    generatedAt: string | null;
    evidence: {
      independentContributors: number;
      timedEvents: number;
      distinctDays: number;
      hasRecentEvidence: boolean;
    };
    strength: "low" | "medium" | "high" | null;
    windows: ForecastWindow[];
    disclaimer: string;
  };
  accuracy: number | null;
  officialSources: Array<{ label: string; url: string }>;
};

type ApiSuccess<T> = { ok: true; data: T };
type ApiFailure = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export class ApiError extends Error {
  code: string;
  details?: unknown;

  constructor(message: string, code = "request_failed", details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError("The server returned an unreadable response.", "invalid_response");
  }

  if (!response.ok || !payload.ok) {
    const error = payload.ok
      ? { code: "request_failed", message: "The request failed." }
      : payload.error;
    throw new ApiError(error.message, error.code, error.details);
  }

  return payload.data;
}

export function emptyAreaSnapshot(area: AreaSnapshot["area"]): AreaSnapshot {
  return {
    area,
    selection: { precision: "upazila" },
    liveState: {
      state: "unknown",
      contributorCount: 0,
      recentContributorCount: 0,
      onContributorCount: 0,
      outContributorCount: 0,
      leadingState: null,
      observedAt: null,
      expiresAt: null,
      precision: "upazila",
    },
    forecast: {
      eligible: false,
      generatedAt: null,
      evidence: {
        independentContributors: 0,
        timedEvents: 0,
        distinctDays: 0,
        hasRecentEvidence: false,
      },
      strength: null,
      windows: [],
      disclaimer: "Community estimate—not an official utility schedule.",
    },
    accuracy: null,
    officialSources: [],
  };
}

export async function getAreaSnapshot(slug: string): Promise<AreaSnapshot> {
  return apiRequest<AreaSnapshot>(`/api/areas/${encodeURIComponent(slug)}`);
}

export async function getMapStatuses() {
  return apiRequest<{
    generatedAt: string;
    areas: Array<{
      upazilaId: string;
      slug: string;
      state: LiveStateName;
      contributorCount: number;
      observedAt: string;
      expiresAt: string;
    }>;
  }>("/api/map/status");
}

export async function getLocalities(parentId: string): Promise<LocationRecord[]> {
  return apiRequest<LocationRecord[]>(
    `/api/localities?parentId=${encodeURIComponent(parentId)}`,
    { cache: "no-store" },
  );
}

export async function createLocality(
  parentId: string,
  name: string,
  inputLocale: "en" | "bn" | "und" = "und",
): Promise<{ location: LocationRecord; created: boolean }> {
  return apiRequest<{ location: LocationRecord; created: boolean }>("/api/localities", {
    method: "POST",
    body: JSON.stringify({ parentId, name, inputLocale }),
  });
}

export async function submitLiveReport(
  state: "out" | "on",
  upazilaId: string,
) {
  return apiRequest<{
    duplicate: boolean;
    eventId: string | null;
    liveState: LiveState;
  }>("/api/reports/live", {
    method: "POST",
    body: JSON.stringify({ state, location: { upazilaId } }),
  });
}

export type DailyWindowInput = {
  startTime: string;
  endTime: string;
  precision: "exact" | "approximate";
};

export async function submitDailyReport(input: {
  upazilaId: string;
  date: string;
  countKnown: boolean;
  outageCount: number | null;
  windows: DailyWindowInput[];
}) {
  return apiRequest<{
    submissionId: string;
    duplicate: boolean;
    insertedEventIds: string[];
    skippedDuplicateWindows: number;
    existingEventIds: string[];
  }>("/api/reports/daily", {
    method: "POST",
    body: JSON.stringify({
      location: { upazilaId: input.upazilaId },
      date: input.date,
      countKnown: input.countKnown,
      outageCount: input.outageCount,
      windows: input.windows,
    }),
  });
}

export async function recordAnalytics(
  event: "area_search" | "report_completed" | "share" | "return_visit" | "forecast_view",
  upazilaId?: string,
) {
  try {
    await apiRequest<{ recorded: boolean }>("/api/analytics", {
      method: "POST",
      body: JSON.stringify({ event, upazilaId }),
      keepalive: true,
    });
  } catch {
    // Analytics is deliberately non-blocking and aggregate-only.
  }
}

export async function deleteMyReports() {
  return apiRequest<{
    reportsDeleted: number;
    dailySubmissionsDeleted: number;
    localityContributionsDeleted: number;
    identityReset: boolean;
  }>("/api/me/reports", {
    method: "DELETE",
    body: JSON.stringify({ confirm: true }),
  });
}
