import { locationKey, locationPrecision } from "@/lib/domain/location";
import type {
  LiveAreaState,
  LocationSelection,
  NormalizedDailyReport,
  ReportedPowerState,
} from "@/lib/domain/types";
import { restRpc, restSelect } from "./supabase-rest";
import { ensureLocationSelection } from "./catalog-seed";

type LiveStateRow = {
  state: "on" | "out";
  contributor_count: number | string;
  observed_at: string;
  expires_at: string;
  precision: "upazila" | "provider_upazila" | "feeder";
};

type LiveRpcResult = {
  duplicate?: boolean;
  event_id?: string | null;
  closed?: boolean;
  live_state?: LiveStateRow | null;
};

function publicLiveState(
  row: LiveStateRow | null | undefined,
  fallbackPrecision: LiveAreaState["precision"],
  now = new Date(),
): LiveAreaState {
  if (!row || Date.parse(row.expires_at) <= now.getTime()) {
    return {
      state: "unknown",
      contributorCount: 0,
      observedAt: null,
      expiresAt: null,
      precision: fallbackPrecision,
    };
  }
  return {
    state: row.state === "out" ? "appears_out" : "appears_on",
    contributorCount: Number(row.contributor_count),
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    precision: row.precision,
  };
}

function locationArgs(location: LocationSelection): Record<string, string | null> {
  return {
    p_upazila_id: location.upazilaId,
    p_provider_id: location.providerId ?? null,
    p_feeder_id: location.feederId ?? null,
  };
}

export async function getLiveState(location: LocationSelection): Promise<LiveAreaState> {
  const rows = await restSelect<LiveStateRow[]>("live_area_states", {
    select: "state,contributor_count,observed_at,expires_at,precision",
    location_key: `eq.${locationKey(location)}`,
    limit: 1,
  });
  return publicLiveState(rows[0], locationPrecision(location));
}

export async function submitLiveStatus(args: {
  visitorHash: string;
  ipHash: string;
  networkHash: string;
  state: ReportedPowerState;
  location: LocationSelection;
}): Promise<{
  duplicate: boolean;
  eventId: string | null;
  liveState: LiveAreaState;
}> {
  await ensureLocationSelection(args.location);
  const result = await restRpc<LiveRpcResult>("api_submit_live_status", {
    p_visitor_hash: args.visitorHash,
    p_ip_hash: args.ipHash,
    p_network_hash: args.networkHash,
    p_state: args.state,
    ...locationArgs(args.location),
  });
  return {
    duplicate: Boolean(result.duplicate),
    eventId: result.event_id ?? null,
    liveState: publicLiveState(result.live_state, locationPrecision(args.location)),
  };
}

export async function closeLiveOutage(args: {
  visitorHash: string;
  ipHash: string;
  networkHash: string;
  eventId: string;
}): Promise<{
  closed: boolean;
  eventId: string;
  liveState: LiveAreaState;
}> {
  const result = await restRpc<LiveRpcResult>("api_close_live_outage", {
    p_visitor_hash: args.visitorHash,
    p_ip_hash: args.ipHash,
    p_network_hash: args.networkHash,
    p_event_id: args.eventId,
  });
  const precision = result.live_state?.precision ?? "upazila";
  return {
    closed: Boolean(result.closed),
    eventId: args.eventId,
    liveState: publicLiveState(result.live_state, precision),
  };
}

type DailyRpcResult = {
  submission_id: string;
  duplicate?: boolean;
  inserted_event_ids?: string[];
  skipped_duplicate_windows?: number;
  existing_event_ids?: string[];
};

export async function submitDailyReport(args: {
  visitorHash: string;
  ipHash: string;
  networkHash: string;
  report: NormalizedDailyReport;
}): Promise<{
  submissionId: string;
  duplicate: boolean;
  insertedEventIds: string[];
  skippedDuplicateWindows: number;
  existingEventIds: string[];
}> {
  await ensureLocationSelection(args.report.location);
  const result = await restRpc<DailyRpcResult>("api_submit_daily_report", {
    p_visitor_hash: args.visitorHash,
    p_ip_hash: args.ipHash,
    p_network_hash: args.networkHash,
    p_occurred_on: args.report.date,
    p_count_known: args.report.countKnown,
    p_outage_count: args.report.outageCount,
    p_windows: args.report.windows,
    ...locationArgs(args.report.location),
  });
  return {
    submissionId: result.submission_id,
    duplicate: Boolean(result.duplicate),
    insertedEventIds: result.inserted_event_ids ?? [],
    skippedDuplicateWindows: Number(result.skipped_duplicate_windows ?? 0),
    existingEventIds: result.existing_event_ids ?? [],
  };
}

type MineRpcResult = {
  date: string;
  events?: Array<{
    id: string;
    started_at: string;
    ended_at: string | null;
    source: "live" | "daily";
    time_precision: "exact" | "approximate";
  }>;
  daily_submission?: {
    id: string;
    count_known: boolean;
    outage_count: number | null;
    remembered_window_count: number;
  } | null;
};

export async function getMyReports(args: {
  visitorHash: string;
  date: string;
  location: LocationSelection;
}): Promise<{
  date: string;
  events: Array<{
    id: string;
    startedAt: string;
    endedAt: string | null;
    source: "live" | "daily";
    isOpen: boolean;
    timePrecision: "exact" | "approximate";
  }>;
  dailySubmission: {
    id: string;
    countKnown: boolean;
    outageCount: number | null;
    rememberedWindowCount: number;
  } | null;
}> {
  await ensureLocationSelection(args.location);
  const result = await restRpc<MineRpcResult>("api_get_my_reports", {
    p_visitor_hash: args.visitorHash,
    p_occurred_on: args.date,
    ...locationArgs(args.location),
  });
  return {
    date: result.date,
    events: (result.events ?? []).map((event) => ({
      id: event.id,
      startedAt: event.started_at,
      endedAt: event.ended_at,
      source: event.source,
      isOpen: event.ended_at === null,
      timePrecision: event.time_precision,
    })),
    dailySubmission: result.daily_submission
      ? {
          id: result.daily_submission.id,
          countKnown: result.daily_submission.count_known,
          outageCount: result.daily_submission.outage_count,
          rememberedWindowCount: result.daily_submission.remembered_window_count,
        }
      : null,
  };
}

export function deleteVisitorData(visitorHash: string, ipHash: string): Promise<{
  dailySubmissions: number;
  outageEvents: number;
  statusConfirmations: number;
  analyticsVisitorDays: number;
}> {
  return restRpc("api_delete_visitor_data", { p_visitor_hash: visitorHash, p_ip_hash: ipHash });
}
