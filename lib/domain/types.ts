export type LocationPrecision = "upazila" | "provider_upazila" | "feeder";
export type LocationKind = "upazila" | "thana" | "locality";
export type MapCoverageKind = "exact" | "approximate" | "district_fallback";

export type LocationSelection = {
  districtId?: string;
  upazilaId: string;
  providerId?: string;
  feederId?: string;
};

export type ReportedPowerState = "on" | "out";
export type PublicPowerState = "unknown" | "appears_on" | "appears_out";
export type TimePrecision = "exact" | "approximate";

export type OutageWindowInput = {
  startTime: string;
  endTime: string;
  precision: TimePrecision;
};

export type NormalizedOutageWindow = {
  startedAt: string;
  endedAt: string;
  precision: TimePrecision;
};

export type LiveStatusInput = {
  state: ReportedPowerState;
  location: LocationSelection;
};

export type DailyReportInput = {
  location: LocationSelection;
  date: string;
  countKnown: boolean;
  outageCount: number | null;
  windows: OutageWindowInput[];
};

export type NormalizedDailyReport = Omit<DailyReportInput, "windows"> & {
  windows: NormalizedOutageWindow[];
};

export type LiveAreaState = {
  state: PublicPowerState;
  contributorCount: number;
  observedAt: string | null;
  expiresAt: string | null;
  precision: LocationPrecision;
};

export type ForecastEvidence = {
  contributorCount: number;
  networkCount: number;
  timedEventCount: number;
  distinctDayCount: number;
  newestEventAt: string | null;
  maximumContributorWeightShare: number;
  thresholds: {
    contributors: number;
    timedEvents: number;
    distinctDays: number;
    freshnessDays: number;
    maximumContributorWeightShare: number;
    maximumContributorsPerNetwork: number;
  };
  missing: string[];
};

export type ForecastWindow = {
  startsAt: string;
  endsAt: string;
  localStartHour: number;
  score: number;
};

export type CommunityForecast = {
  eligible: boolean;
  generatedAt: string;
  evidence: ForecastEvidence;
  strength: "insufficient" | "low" | "medium" | "high";
  windows: ForecastWindow[];
  disclaimer: string;
};

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
