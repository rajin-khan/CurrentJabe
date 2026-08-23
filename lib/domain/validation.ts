import { isLocationId } from "./location";
import {
  canonicalizeLocalityName,
  type CanonicalLocalityName,
} from "./locality";
import type {
  DailyReportInput,
  LiveStatusInput,
  LocationSelection,
  NormalizedDailyReport,
  NormalizedOutageWindow,
  OutageWindowInput,
  TimePrecision,
} from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DHAKA_UTC_OFFSET_MS = 6 * 60 * 60 * 1000;
const MAX_DAILY_OUTAGES = 24;
const MAX_WINDOW_HOURS = 24;

export class ValidationError extends Error {
  readonly code = "validation_error";
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function validateLocation(value: unknown): LocationSelection {
  const input = asRecord(value, "location");
  const districtId = input.districtId;
  const upazilaId = input.upazilaId;
  const providerId = input.providerId;
  const feederId = input.feederId;

  if (!isLocationId(upazilaId)) {
    throw new ValidationError("A valid upazilaId is required.");
  }
  if (districtId !== undefined && !isLocationId(districtId)) {
    throw new ValidationError("districtId is invalid.");
  }
  if (providerId !== undefined && providerId !== null && !isLocationId(providerId)) {
    throw new ValidationError("providerId is invalid.");
  }
  if (feederId !== undefined && feederId !== null && !isLocationId(feederId)) {
    throw new ValidationError("feederId is invalid.");
  }
  if (feederId && !providerId) {
    throw new ValidationError("A feederId requires a providerId.");
  }

  return {
    ...(isLocationId(districtId) ? { districtId } : {}),
    upazilaId,
    ...(isLocationId(providerId) ? { providerId } : {}),
    ...(isLocationId(feederId) ? { feederId } : {}),
  };
}

export type CommunityLocalityInput = CanonicalLocalityName & {
  parentId: string;
  inputLocale: "en" | "bn" | "und";
};

export function validateCommunityLocality(value: unknown): CommunityLocalityInput {
  const input = asRecord(value, "request body");
  if (!isLocationId(input.parentId)) {
    throw new ValidationError("A valid parent area is required.");
  }
  if (typeof input.name !== "string") {
    throw new ValidationError("A specific area name is required.");
  }
  const inputLocale = input.inputLocale === "en" || input.inputLocale === "bn"
    ? input.inputLocale
    : "und";
  try {
    return {
      parentId: input.parentId,
      inputLocale,
      ...canonicalizeLocalityName(input.name),
    };
  } catch (error) {
    throw new ValidationError(
      error instanceof Error ? error.message : "That specific area name is invalid.",
    );
  }
}

export function validateLiveStatus(value: unknown): LiveStatusInput {
  const input = asRecord(value, "request body");
  if (input.state !== "on" && input.state !== "out") {
    throw new ValidationError("state must be either 'on' or 'out'.");
  }
  return { state: input.state, location: validateLocation(input.location) };
}

function parseTime(value: unknown, label: string): { hour: number; minute: number } {
  if (typeof value !== "string") {
    throw new ValidationError(`${label} must use HH:mm time.`);
  }
  const match = TIME_RE.exec(value);
  if (!match) throw new ValidationError(`${label} must use 24-hour HH:mm time.`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function validatePrecision(value: unknown): TimePrecision {
  if (value !== "exact" && value !== "approximate") {
    throw new ValidationError("Window precision must be 'exact' or 'approximate'.");
  }
  return value;
}

function dateParts(date: string): { year: number; month: number; day: number } {
  if (!DATE_RE.test(date)) throw new ValidationError("date must use YYYY-MM-DD.");
  const [year, month, day] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new ValidationError("date is not a real calendar date.");
  }
  return { year, month, day };
}

export function dhakaDateString(date = new Date()): string {
  const shifted = new Date(date.getTime() + DHAKA_UTC_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousDate(date: string): string {
  const { year, month, day } = dateParts(date);
  const previous = new Date(Date.UTC(year, month - 1, day) - 86_400_000);
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-${String(previous.getUTCDate()).padStart(2, "0")}`;
}

export function isTodayOrYesterdayInDhaka(date: string, now = new Date()): boolean {
  const today = dhakaDateString(now);
  return date === today || date === previousDate(today);
}

export function normalizeWindow(date: string, value: unknown): NormalizedOutageWindow {
  const input = asRecord(value, "window");
  const start = parseTime(input.startTime, "startTime");
  const end = parseTime(input.endTime, "endTime");
  const precision = validatePrecision(input.precision);
  const { year, month, day } = dateParts(date);

  const localStartAsUtc = Date.UTC(year, month - 1, day, start.hour, start.minute);
  let localEndAsUtc = Date.UTC(year, month - 1, day, end.hour, end.minute);
  if (localEndAsUtc === localStartAsUtc) {
    throw new ValidationError("An outage window must have different start and end times.");
  }
  if (localEndAsUtc < localStartAsUtc) localEndAsUtc += 86_400_000;

  const duration = localEndAsUtc - localStartAsUtc;
  if (duration <= 0 || duration > MAX_WINDOW_HOURS * 3_600_000) {
    throw new ValidationError(`Each outage window must be longer than zero and at most ${MAX_WINDOW_HOURS} hours.`);
  }

  return {
    startedAt: new Date(localStartAsUtc - DHAKA_UTC_OFFSET_MS).toISOString(),
    endedAt: new Date(localEndAsUtc - DHAKA_UTC_OFFSET_MS).toISOString(),
    precision,
  };
}

export function validateDailyReport(value: unknown, now = new Date()): NormalizedDailyReport {
  const input = asRecord(value, "request body");
  if (typeof input.date !== "string" || !DATE_RE.test(input.date)) {
    throw new ValidationError("date must use YYYY-MM-DD.");
  }
  dateParts(input.date);
  if (!isTodayOrYesterdayInDhaka(input.date, now)) {
    throw new ValidationError("Daily reports can only be submitted for today or yesterday in Bangladesh time.");
  }
  if (typeof input.countKnown !== "boolean") {
    throw new ValidationError("countKnown must be true or false.");
  }

  let outageCount: number | null = null;
  if (input.countKnown) {
    if (!Number.isInteger(input.outageCount) || Number(input.outageCount) < 0 || Number(input.outageCount) > MAX_DAILY_OUTAGES) {
      throw new ValidationError(`outageCount must be a whole number from 0 to ${MAX_DAILY_OUTAGES}.`);
    }
    outageCount = Number(input.outageCount);
  } else if (input.outageCount !== undefined && input.outageCount !== null) {
    throw new ValidationError("outageCount must be null when countKnown is false.");
  }

  if (!Array.isArray(input.windows) || input.windows.length > MAX_DAILY_OUTAGES) {
    throw new ValidationError(`windows must be an array with at most ${MAX_DAILY_OUTAGES} entries.`);
  }
  const windows = input.windows.map((window) => normalizeWindow(input.date as string, window));
  if (windows.some((window) => Date.parse(window.endedAt) > now.getTime() + 5 * 60 * 1000)) {
    throw new ValidationError("Outage times cannot end in the future.");
  }
  if (input.countKnown && outageCount !== null && windows.length > outageCount) {
    throw new ValidationError("There cannot be more remembered windows than the reported daily outage count.");
  }
  if (!input.countKnown && windows.length === 0) {
    throw new ValidationError("Add at least one remembered window when the daily count is unknown.");
  }

  return {
    location: validateLocation(input.location),
    date: input.date,
    countKnown: input.countKnown,
    outageCount,
    windows,
  };
}

export function validateUuid(value: unknown, label = "id"): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ValidationError(`${label} must be a UUID.`);
  }
  return value;
}

export type { OutageWindowInput };
