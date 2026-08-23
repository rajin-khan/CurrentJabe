import "server-only";

type QueryValue = string | number | boolean | null | undefined;

export class SupabaseConfigurationError extends Error {
  readonly code = "supabase_not_configured";

  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

export class SupabaseRestError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly hint?: string;
  readonly status: number;

  constructor(status: number, payload: unknown) {
    const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const message = typeof body.message === "string" ? body.message : `Supabase REST request failed (${status}).`;
    super(message);
    this.name = "SupabaseRestError";
    this.code = typeof body.code === "string" ? body.code : "supabase_rest_error";
    this.details = body.details ?? null;
    this.hint = typeof body.hint === "string" ? body.hint : undefined;
    this.status = status;
  }
}

const SUPABASE_REQUEST_TIMEOUT_MS = 10_000;

function configuration(): { restUrl: string; serviceRoleKey: string } {
  const projectUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!projectUrl || !serviceRoleKey) {
    throw new SupabaseConfigurationError(
      "The isolated CurrentJabe Supabase URL and service-role key are not configured.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(projectUrl);
  } catch {
    throw new SupabaseConfigurationError("SUPABASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new SupabaseConfigurationError("SUPABASE_URL must use HTTPS outside local development.");
  }
  return { restUrl: `${parsed.origin}/rest/v1`, serviceRoleKey };
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const { restUrl } = configuration();
  const url = new URL(`${restUrl}/${path.replace(/^\//, "")}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  query?: Record<string, QueryValue>,
): Promise<T> {
  const { serviceRoleKey } = configuration();
  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS),
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new SupabaseRestError(timedOut ? 504 : 502, {
      message: timedOut ? "supabase_request_timeout" : "supabase_unreachable",
    });
  }
  const payload = await parsePayload(response);
  if (!response.ok) throw new SupabaseRestError(response.status, payload);
  return payload as T;
}

export function restSelect<T>(
  table: string,
  query: Record<string, QueryValue>,
): Promise<T> {
  return request<T>(table, { method: "GET" }, query);
}

export function restInsert<T>(table: string, value: unknown): Promise<T> {
  return request<T>(
    table,
    { method: "POST", body: JSON.stringify(value), headers: { Prefer: "return=representation" } },
  );
}

export function restInsertIgnore<T>(
  table: string,
  value: unknown,
  conflictColumns?: readonly string[],
): Promise<T> {
  return request<T>(
    table,
    {
      method: "POST",
      body: JSON.stringify(value),
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    },
    conflictColumns?.length
      ? { on_conflict: conflictColumns.join(",") }
      : undefined,
  );
}

export function restPatch<T>(
  table: string,
  query: Record<string, QueryValue>,
  value: unknown,
): Promise<T> {
  return request<T>(
    table,
    { method: "PATCH", body: JSON.stringify(value), headers: { Prefer: "return=representation" } },
    query,
  );
}

export function restDelete<T>(table: string, query: Record<string, QueryValue>): Promise<T> {
  return request<T>(table, { method: "DELETE", headers: { Prefer: "return=representation" } }, query);
}

export async function restRpc<T>(functionName: string, args: Record<string, unknown>): Promise<T> {
  return request<T>(`rpc/${functionName}`, { method: "POST", body: JSON.stringify(args) });
}
