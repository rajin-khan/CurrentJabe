import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/admin-auth";
import { adminNoIndex, routeError, success } from "@/lib/server/http";
import { restRpc } from "@/lib/server/supabase-rest";

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days") ?? 30) || 30));
    const analytics = await restRpc("admin_get_analytics", { p_days: days });
    return adminNoIndex(success(analytics));
  } catch (error) {
    return adminNoIndex(routeError(error));
  }
}
