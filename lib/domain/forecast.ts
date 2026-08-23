import type { CommunityForecast, ForecastEvidence, ForecastWindow } from "./types";

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ForecastEvidenceRow = {
  id: string;
  visitor_hash: string;
  network_hash: string;
  started_at: string;
  ended_at: string;
  time_precision: "exact" | "approximate";
  reputation_score: number | string | null;
};

const THRESHOLDS = {
  contributors: 10,
  timedEvents: 10,
  distinctDays: 3,
  freshnessDays: 7,
  maximumContributorWeightShare: 0.2,
  maximumContributorsPerNetwork: 3,
} as const;

function shiftedDhakaDate(date: Date): Date {
  return new Date(date.getTime() + DHAKA_OFFSET_MS);
}

function dhakaDayKey(date: Date): string {
  const shifted = shiftedDhakaDate(date);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function numericScore(value: number | string | null): number {
  const score = Number(value ?? 0.75);
  return Number.isFinite(score) ? Math.min(1.25, Math.max(0.25, score)) : 0.75;
}

function baseWeight(event: ForecastEvidenceRow, now: Date): number {
  const endedAt = new Date(event.ended_at);
  const ageDays = Math.max(0, (now.getTime() - endedAt.getTime()) / DAY_MS);
  const recency = Math.pow(2, -ageDays / 7);
  const precision = event.time_precision === "exact" ? 1 : 0.75;
  return recency * precision * numericScore(event.reputation_score);
}

function validEvents(rows: ForecastEvidenceRow[], now: Date): ForecastEvidenceRow[] {
  const oldest = now.getTime() - 35 * DAY_MS;
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    const startedAt = Date.parse(row.started_at);
    const endedAt = Date.parse(row.ended_at);
    return (
      Boolean(row.visitor_hash) &&
      Boolean(row.network_hash) &&
      Number.isFinite(startedAt) &&
      Number.isFinite(endedAt) &&
      endedAt > startedAt &&
      endedAt >= oldest &&
      startedAt <= now.getTime()
    );
  });
}

function capNetworkContributors(rows: ForecastEvidenceRow[]): ForecastEvidenceRow[] {
  const allowedVisitors = new Map<string, Set<string>>();
  const accepted = new Set<string>();

  for (const row of [...rows].sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at))) {
    const visitors = allowedVisitors.get(row.network_hash) ?? new Set<string>();
    if (visitors.has(row.visitor_hash)) {
      accepted.add(row.id);
      continue;
    }
    if (visitors.size < THRESHOLDS.maximumContributorsPerNetwork) {
      visitors.add(row.visitor_hash);
      allowedVisitors.set(row.network_hash, visitors);
      accepted.add(row.id);
    }
  }

  return rows.filter((row) => accepted.has(row.id));
}

function buildEvidence(events: ForecastEvidenceRow[], now: Date): ForecastEvidence {
  const contributors = new Set(events.map((event) => event.visitor_hash));
  const networks = new Set(events.map((event) => event.network_hash));
  const days = new Set(events.map((event) => dhakaDayKey(new Date(event.started_at))));
  const newestMs = events.reduce((latest, event) => Math.max(latest, Date.parse(event.ended_at)), 0);
  const weights = new Map<string, number>();
  let totalWeight = 0;
  for (const event of events) {
    const weight = baseWeight(event, now);
    totalWeight += weight;
    weights.set(event.visitor_hash, (weights.get(event.visitor_hash) ?? 0) + weight);
  }
  const maxWeight = Math.max(0, ...weights.values());
  const maximumContributorWeightShare = totalWeight > 0 ? maxWeight / totalWeight : 1;
  const freshnessDays = newestMs ? (now.getTime() - newestMs) / DAY_MS : Number.POSITIVE_INFINITY;

  const missing: string[] = [];
  if (contributors.size < THRESHOLDS.contributors) {
    missing.push(`${THRESHOLDS.contributors - contributors.size} more independent contributor${THRESHOLDS.contributors - contributors.size === 1 ? "" : "s"}`);
  }
  if (events.length < THRESHOLDS.timedEvents) {
    missing.push(`${THRESHOLDS.timedEvents - events.length} more timed outage event${THRESHOLDS.timedEvents - events.length === 1 ? "" : "s"}`);
  }
  if (days.size < THRESHOLDS.distinctDays) {
    missing.push(`reports across ${THRESHOLDS.distinctDays - days.size} more day${THRESHOLDS.distinctDays - days.size === 1 ? "" : "s"}`);
  }
  if (freshnessDays > THRESHOLDS.freshnessDays) missing.push("a fresh report from the last 7 days");
  if (maximumContributorWeightShare > THRESHOLDS.maximumContributorWeightShare) {
    missing.push("a less concentrated mix of independent evidence");
  }

  return {
    contributorCount: contributors.size,
    networkCount: networks.size,
    timedEventCount: events.length,
    distinctDayCount: days.size,
    newestEventAt: newestMs ? new Date(newestMs).toISOString() : null,
    maximumContributorWeightShare,
    thresholds: { ...THRESHOLDS },
    missing,
  };
}

function addEventToBins(scores: number[], event: ForecastEvidenceRow, weight: number): void {
  const start = new Date(event.started_at);
  const end = new Date(event.ended_at);
  let cursor = Math.floor(start.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS;
  const hardStop = Math.min(end.getTime(), start.getTime() + DAY_MS);

  while (cursor < hardStop) {
    const segmentStart = Math.max(cursor, start.getTime());
    const segmentEnd = Math.min(cursor + HALF_HOUR_MS, hardStop);
    if (segmentEnd > segmentStart) {
      const dhaka = shiftedDhakaDate(new Date(cursor));
      const bin = dhaka.getUTCHours() * 2 + (dhaka.getUTCMinutes() >= 30 ? 1 : 0);
      scores[bin] += weight * ((segmentEnd - segmentStart) / HALF_HOUR_MS);
    }
    cursor += HALF_HOUR_MS;
  }
}

function targetStartForHour(hour: number, now: Date): Date {
  const dhakaNow = shiftedDhakaDate(now);
  let target = Date.UTC(
    dhakaNow.getUTCFullYear(),
    dhakaNow.getUTCMonth(),
    dhakaNow.getUTCDate(),
    hour,
  ) - DHAKA_OFFSET_MS;
  if (target <= now.getTime()) target += DAY_MS;
  return new Date(target);
}

function selectWindows(hourScores: number[], now: Date): ForecastWindow[] {
  const maximum = Math.max(...hourScores);
  if (!(maximum > 0)) return [];

  const ranked = hourScores
    .map((score, hour) => ({ hour, score }))
    .filter(({ score }) => score >= maximum * 0.45)
    .sort((a, b) => b.score - a.score || a.hour - b.hour);

  const chosen: Array<{ hour: number; score: number }> = [];
  for (const candidate of ranked) {
    const tooClose = chosen.some(({ hour }) => {
      const difference = Math.abs(hour - candidate.hour);
      return Math.min(difference, 24 - difference) <= 1;
    });
    if (!tooClose) chosen.push(candidate);
    if (chosen.length === 3) break;
  }

  return chosen
    .map(({ hour, score }) => {
      const start = targetStartForHour(hour, now);
      return {
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
        localStartHour: hour,
        score: Number((score / maximum).toFixed(3)),
      };
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function computeCommunityForecast(
  rows: ForecastEvidenceRow[],
  now = new Date(),
): CommunityForecast {
  const events = capNetworkContributors(validEvents(rows, now));
  const evidence = buildEvidence(events, now);
  const eligible = evidence.missing.length === 0;
  const disclaimer = "Community estimate. This is not an official electricity schedule.";

  if (!eligible) {
    return {
      eligible: false,
      generatedAt: now.toISOString(),
      evidence,
      strength: "insufficient",
      windows: [],
      disclaimer,
    };
  }

  const binScores = Array.from({ length: 48 }, () => 0);
  for (const event of events) addEventToBins(binScores, event, baseWeight(event, now));
  const hourScores = Array.from({ length: 24 }, (_, hour) => binScores[hour * 2] + binScores[hour * 2 + 1]);
  const windows = selectWindows(hourScores, now);

  const evidenceVolume = Math.min(1, events.length / 50);
  const breadth = Math.min(1, evidence.contributorCount / 30);
  const span = Math.min(1, evidence.distinctDayCount / 7);
  const strengthScore = evidenceVolume * 0.4 + breadth * 0.4 + span * 0.2;
  const strength = strengthScore >= 0.72 ? "high" : strengthScore >= 0.42 ? "medium" : "low";

  return {
    eligible: windows.length > 0,
    generatedAt: now.toISOString(),
    evidence,
    strength: windows.length > 0 ? strength : "insufficient",
    windows,
    disclaimer,
  };
}
