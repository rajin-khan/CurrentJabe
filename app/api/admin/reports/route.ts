import { NextRequest } from "next/server";
import { isLocationId } from "@/lib/domain/location";
import { requireAdmin } from "@/lib/server/admin-auth";
import { adminNoIndex, HttpError, routeError, success } from "@/lib/server/http";
import { restSelect } from "@/lib/server/supabase-rest";

type ReportEntity = "daily_submission" | "outage_event" | "status_confirmation";

type RawReport = Record<string, unknown> & {
  id: string;
  visitor_hash: string;
  network_hash?: string;
  created_at: string;
  suppressed_at: string | null;
};

function redact(entityType: ReportEntity, row: RawReport) {
  const { visitor_hash: visitorHash, network_hash: _networkHash, ...rest } = row;
  return { entityType, ...rest, visitorFingerprint: visitorHash.slice(0, 12) };
}

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const search = request.nextUrl.searchParams;
    const type = search.get("type") as ReportEntity | null;
    if (type && !["daily_submission", "outage_event", "status_confirmation"].includes(type)) {
      throw new HttpError(400, "invalid_report_type", "Unknown report type filter.");
    }
    const upazilaId = search.get("upazilaId");
    if (upazilaId && !isLocationId(upazilaId)) throw new HttpError(400, "invalid_location", "upazilaId is invalid.");
    const limit = Math.min(100, Math.max(1, Number(search.get("limit") ?? 50) || 50));
    const offset = Math.max(0, Number(search.get("offset") ?? 0) || 0);
    const suppressed = search.get("suppressed");
    if (suppressed && suppressed !== "yes" && suppressed !== "no") {
      throw new HttpError(400, "invalid_filter", "suppressed must be yes or no.");
    }
    const filters = {
      ...(upazilaId ? { upazila_id: `eq.${upazilaId}` } : {}),
      ...(suppressed === "yes" ? { suppressed_at: "not.is.null" } : {}),
      ...(suppressed === "no" ? { suppressed_at: "is.null" } : {}),
      order: "created_at.desc",
      limit,
      offset,
    };

    const [daily, events, statuses] = await Promise.all([
      !type || type === "daily_submission"
        ? restSelect<RawReport[]>("daily_submissions", { select: "*", ...filters })
        : Promise.resolve([]),
      !type || type === "outage_event"
        ? restSelect<RawReport[]>("outage_events", { select: "*", ...filters })
        : Promise.resolve([]),
      !type || type === "status_confirmation"
        ? restSelect<RawReport[]>("status_confirmations", { select: "*", ...filters })
        : Promise.resolve([]),
    ]);
    const reports = [
      ...daily.map((row) => redact("daily_submission", row)),
      ...events.map((row) => redact("outage_event", row)),
      ...statuses.map((row) => redact("status_confirmation", row)),
    ]
      .sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)))
      .slice(0, limit);
    return adminNoIndex(success({ reports, limit, offset }));
  } catch (error) {
    return adminNoIndex(routeError(error));
  }
}
