import { locationKey, locationPrecision } from "@/lib/domain/location";
import type {
  LiveAreaState,
  LocationSelection,
  NormalizedDailyReport,
  ReportedPowerState,
} from "@/lib/domain/types";
import { restRpc, restSelect, SupabaseRestError } from "./supabase-rest";
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

type LiveEvidenceSummaryRow = {
  on_count: number | string;
  out_count: number | string;
  leading_state: "on" | "out" | null;
  leading_count: number | string;
  latest_at: string | null;
  precision: LiveAreaState["precision"];
};

type RecentConfirmationRow = {
  id: string;
  visitor_hash: string;
  network_hash: string;
  state: "on" | "out";
  observed_at: string;
};

type ReputationRow = {
  visitor_hash: string;
  score: number | string;
};

const LIVE_EVIDENCE_WINDOW_MS = 24 * 60 * 60 * 1000;

type LiveEvidenceSummary = {
  onCount: number;
  outCount: number;
  leadingState: "on" | "out" | null;
  leadingCount: number;
  latestAt: string | null;
  precision: LiveAreaState["precision"];
};

function numericCount(value: number | string | null | undefined): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function normalizeLiveSummary(
  row: LiveEvidenceSummaryRow,
  fallbackPrecision: LiveAreaState["precision"],
): LiveEvidenceSummary {
  const onCount = numericCount(row.on_count);
  const outCount = numericCount(row.out_count);
  const leadingState = row.leading_state === "on" || row.leading_state === "out"
    ? row.leading_state
    : null;
  return {
    onCount,
    outCount,
    leadingState,
    leadingCount: numericCount(row.leading_count),
    latestAt: row.latest_at ?? null,
    precision: row.precision ?? fallbackPrecision,
  };
}

async function fallbackLiveEvidenceSummary(
  location: LocationSelection,
): Promise<LiveEvidenceSummary> {
  const precision = locationPrecision(location);
  const rows = await restSelect<RecentConfirmationRow[]>("status_confirmations", {
    select: "id,visitor_hash,network_hash,state,observed_at",
    upazila_id: `eq.${location.upazilaId}`,
    provider_id: location.providerId ? `eq.${location.providerId}` : undefined,
    feeder_id: location.feederId ? `eq.${location.feederId}` : undefined,
    suppressed_at: "is.null",
    observed_at: `gte.${new Date(Date.now() - LIVE_EVIDENCE_WINDOW_MS).toISOString()}`,
    order: "observed_at.desc,id.desc",
    limit: 500,
  });

  const latestByVisitor = new Map<string, RecentConfirmationRow>();
  for (const row of rows) {
    if (!latestByVisitor.has(row.visitor_hash)) latestByVisitor.set(row.visitor_hash, row);
  }
  const visitors = [...latestByVisitor.keys()];
  const reputations = new Map<string, number>();
  for (let index = 0; index < visitors.length; index += 75) {
    const chunk = visitors.slice(index, index + 75);
    const reputationRows = await restSelect<ReputationRow[]>("visitor_reputation", {
      select: "visitor_hash,score",
      visitor_hash: `in.(${chunk.join(",")})`,
    });
    for (const row of reputationRows) reputations.set(row.visitor_hash, Number(row.score));
  }

  let onCount = 0;
  let outCount = 0;
  let latestOn: string | null = null;
  let latestOut: string | null = null;
  const networkCounts = new Map<string, number>();
  for (const row of latestByVisitor.values()) {
    if ((reputations.get(row.visitor_hash) ?? 0.75) < 0.5) continue;
    const networkCount = networkCounts.get(row.network_hash) ?? 0;
    if (networkCount >= 3) continue;
    networkCounts.set(row.network_hash, networkCount + 1);
    if (row.state === "on") {
      onCount += 1;
      latestOn ??= row.observed_at;
    } else {
      outCount += 1;
      latestOut ??= row.observed_at;
    }
  }

  let leadingState: "on" | "out" | null = null;
  if (onCount > outCount) leadingState = "on";
  else if (outCount > onCount) leadingState = "out";
  else if (onCount > 0) {
    leadingState = Date.parse(latestOut ?? "") >= Date.parse(latestOn ?? "") ? "out" : "on";
  }
  return {
    onCount,
    outCount,
    leadingState,
    leadingCount: leadingState === "on" ? onCount : leadingState === "out" ? outCount : 0,
    latestAt: [latestOn, latestOut]
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
    precision,
  };
}

async function getLiveEvidenceSummary(location: LocationSelection): Promise<LiveEvidenceSummary> {
  try {
    const row = await restRpc<LiveEvidenceSummaryRow>("get_live_evidence_summary", locationArgs(location));
    return normalizeLiveSummary(row, locationPrecision(location));
  } catch (error) {
    // Keep deployments compatible while the additive migration reaches the
    // database. The fallback stays server-only and applies the same caps.
    if (error instanceof SupabaseRestError && (error.code === "PGRST202" || error.status === 404)) {
      return fallbackLiveEvidenceSummary(location);
    }
    throw error;
  }
}

function publicLiveState(
  row: LiveStateRow | null | undefined,
  fallbackPrecision: LiveAreaState["precision"],
  summary?: LiveEvidenceSummary,
  now = new Date(),
): LiveAreaState {
  const active = Boolean(row && Date.parse(row.expires_at) > now.getTime());
  const onContributorCount = summary?.onCount ?? (active && row?.state === "on" ? Number(row.contributor_count) : 0);
  const outContributorCount = summary?.outCount ?? (active && row?.state === "out" ? Number(row.contributor_count) : 0);
  const leadingState = summary?.leadingState ?? (active ? row?.state ?? null : null);
  const contributorCount = active ? Number(row?.contributor_count ?? 0) : 0;
  const recentContributorCount = summary?.leadingCount ?? contributorCount;
  if (!active || !row) {
    return {
      state: "unknown",
      contributorCount,
      recentContributorCount,
      onContributorCount,
      outContributorCount,
      leadingState,
      observedAt: summary?.latestAt ?? null,
      expiresAt: null,
      precision: summary?.precision ?? fallbackPrecision,
    };
  }
  return {
    state: row.state === "out" ? "appears_out" : "appears_on",
    contributorCount,
    recentContributorCount,
    onContributorCount,
    outContributorCount,
    leadingState,
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
  const [rows, summary] = await Promise.all([
    restSelect<LiveStateRow[]>("live_area_states", {
      select: "state,contributor_count,observed_at,expires_at,precision",
      location_key: `eq.${locationKey(location)}`,
      limit: 1,
    }),
    getLiveEvidenceSummary(location),
  ]);
  return publicLiveState(rows[0], locationPrecision(location), summary);
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
  const liveState = await getLiveState(args.location);
  return {
    duplicate: Boolean(result.duplicate),
    eventId: result.event_id ?? null,
    liveState,
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
  merged?: boolean;
  inserted_event_ids?: string[];
  skipped_duplicate_windows?: number;
  existing_event_ids?: string[];
};

type PersonalReports = Awaited<ReturnType<typeof getMyReports>>;

function cumulativeDailyReport(
  report: NormalizedDailyReport,
  existing: PersonalReports | null,
): NormalizedDailyReport {
  if (!existing) return report;
  const existingFloor = Math.max(
    existing.events.length,
    existing.dailySubmission?.outageCount ?? 0,
  );
  const countKnown = report.countKnown || Boolean(existing.dailySubmission?.countKnown);
  if (!countKnown) return report;
  return {
    ...report,
    countKnown: true,
    outageCount: Math.min(
      24,
      Math.max(
        report.outageCount ?? 0,
        existingFloor,
        existingFloor + report.windows.length,
        report.windows.length,
      ),
    ),
  };
}

export async function submitDailyReport(args: {
  visitorHash: string;
  ipHash: string;
  networkHash: string;
  report: NormalizedDailyReport;
}): Promise<{
  submissionId: string;
  duplicate: boolean;
  merged: boolean;
  insertedEventIds: string[];
  skippedDuplicateWindows: number;
  existingEventIds: string[];
}> {
  await ensureLocationSelection(args.report.location);
  let existing: PersonalReports | null = null;
  try {
    existing = await getMyReports({
      visitorHash: args.visitorHash,
      date: args.report.date,
      location: args.report.location,
    });
  } catch {
    // The mutation still has its own database checks. If this convenience read
    // fails, do not turn it into a new client-side blocker.
  }
  let report = cumulativeDailyReport(args.report, existing);
  const submit = (nextReport: NormalizedDailyReport) => restRpc<DailyRpcResult>(
    "api_submit_daily_report",
    {
      p_visitor_hash: args.visitorHash,
      p_ip_hash: args.ipHash,
      p_network_hash: args.networkHash,
      p_occurred_on: nextReport.date,
      p_count_known: nextReport.countKnown,
      p_outage_count: nextReport.outageCount,
      p_windows: nextReport.windows,
      ...locationArgs(nextReport.location),
    },
  );

  let result: DailyRpcResult;
  try {
    result = await submit(report);
  } catch (error) {
    const canRetry = error instanceof SupabaseRestError &&
      error.message.toLowerCase().includes("invalid_outage_count_below");
    if (!canRetry) throw error;
    const refreshed = await getMyReports({
      visitorHash: args.visitorHash,
      date: args.report.date,
      location: args.report.location,
    });
    report = cumulativeDailyReport(report, refreshed);
    result = await submit(report);
  }
  return {
    submissionId: result.submission_id,
    duplicate: Boolean(result.duplicate),
    merged: Boolean(result.merged),
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
  localityContributions: number;
}> {
  return restRpc("api_delete_visitor_data_v2", { p_visitor_hash: visitorHash, p_ip_hash: ipHash });
}
