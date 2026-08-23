import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/admin-auth";
import { getLocationCatalog } from "@/lib/server/area-data";
import { adminNoIndex, routeError, success } from "@/lib/server/http";
import { restSelect } from "@/lib/server/supabase-rest";

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const limit = Math.min(1_000, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 1_000) || 1_000));
    const offset = Math.max(0, Number(request.nextUrl.searchParams.get("offset") ?? 0) || 0);
    const [catalog, mappings] = await Promise.all([
      getLocationCatalog({ includeDisabled: true }),
      restSelect<unknown[]>("area_provider_mappings", { select: "*", active: "eq.true", order: "upazila_id.asc" }),
    ]);
    const areas = catalog.upazilas.slice(offset, offset + limit);
    return adminNoIndex(success({ areas, mappings, limit, offset }));
  } catch (error) {
    return adminNoIndex(routeError(error));
  }
}
