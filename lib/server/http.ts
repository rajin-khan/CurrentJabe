import { NextResponse } from "next/server";
import { ValidationError } from "@/lib/domain/validation";
import { SupabaseConfigurationError, SupabaseRestError } from "./supabase-rest";

const MAX_JSON_BYTES = 64 * 1024;

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ValidationError("Content-Type must be application/json.");
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) {
    throw new ValidationError("Request body is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new ValidationError("Request body is too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError("Request body must contain valid JSON.");
  }
}

export function success<T>(data: T, init?: ResponseInit): NextResponse {
  const response = NextResponse.json({ ok: true, data }, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function cachedSuccess<T>(data: T, maxAgeSeconds: number): NextResponse {
  return NextResponse.json(
    { ok: true, data },
    { headers: { "Cache-Control": `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 2}` } },
  );
}

export function failure(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse {
  const response = NextResponse.json(
    { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function databaseErrorStatus(error: SupabaseRestError): { status: number; code: string; message: string } {
  const normalized = error.message.toLowerCase();
  if (normalized.includes("rate_limit_exceeded")) {
    return { status: 429, code: "rate_limit_exceeded", message: "Too many requests. Please wait and try again." };
  }
  if (normalized.includes("supabase_request_timeout")) {
    return { status: 504, code: "database_timeout", message: "The community data service took too long to respond." };
  }
  if (normalized.includes("supabase_unreachable")) {
    return { status: 502, code: "database_unreachable", message: "The community data service is temporarily unreachable." };
  }
  if (normalized.includes("submissions_disabled")) {
    return { status: 503, code: "submissions_disabled", message: "Community submissions are temporarily paused." };
  }
  if (normalized.includes("area_disabled")) {
    return { status: 423, code: "area_disabled", message: "Community reporting is temporarily unavailable for this area." };
  }
  if (normalized.includes("duplicate_daily_submission")) {
    return { status: 409, code: "duplicate_daily_submission", message: "A daily report already exists for this browser and area." };
  }
  if (normalized.includes("not_found")) {
    return { status: 404, code: "not_found", message: "The requested record was not found." };
  }
  if (normalized.includes("invalid_")) {
    return { status: 400, code: "invalid_request", message: "The submitted data did not pass server validation." };
  }
  return { status: 502, code: "database_error", message: "The community data service could not complete this request." };
}

export function routeError(error: unknown): NextResponse {
  if (error instanceof ValidationError) {
    return failure(400, error.code, error.message, error.details);
  }
  if (error instanceof SupabaseConfigurationError) {
    return failure(503, error.code, error.message);
  }
  if (error instanceof SupabaseRestError) {
    console.error(
      [
        `CurrentJabe Supabase REST error [${error.status} ${error.code}]: ${error.message}`,
        error.hint ? `Hint: ${error.hint}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const mapped = databaseErrorStatus(error);
    return failure(mapped.status, mapped.code, mapped.message);
  }
  if (error instanceof HttpError) return failure(error.status, error.code, error.message, error.details);
  console.error("Unhandled CurrentJabe API error", error);
  return failure(500, "internal_error", "Something went wrong while processing this request.");
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host");
  if (!host) throw new HttpError(403, "origin_rejected", "Request origin could not be verified.");
  const expectedProtocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const expected = `${expectedProtocol}://${host}`;
  if (origin !== expected) throw new HttpError(403, "origin_rejected", "Cross-origin mutation rejected.");
}

export function adminNoIndex(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}
