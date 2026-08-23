import type { LocationSelection } from "@/lib/domain/types";
import { restRpc } from "./supabase-rest";

export const ANALYTICS_EVENTS = [
  "area_search",
  "report_completed",
  "share",
  "return_visit",
  "forecast_view",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export async function recordAnalytics(args: {
  event: AnalyticsEvent;
  visitorHash: string;
  ipHash: string;
  upazilaId?: string;
}): Promise<void> {
  await restRpc("record_analytics_event", {
    p_event_name: args.event,
    p_visitor_hash: args.visitorHash,
    p_ip_hash: args.ipHash,
    p_upazila_id: args.upazilaId ?? null,
  });
}

export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  return typeof value === "string" && (ANALYTICS_EVENTS as readonly string[]).includes(value);
}

export type { LocationSelection };

