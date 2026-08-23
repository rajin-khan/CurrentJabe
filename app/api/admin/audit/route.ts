import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/admin-auth";
import { adminNoIndex, routeError, success } from "@/lib/server/http";
import { restSelect } from "@/lib/server/supabase-rest";

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 100) || 100));
    const entries = await restSelect<unknown[]>("audit_log", {
      select: "*",
      order: "created_at.desc",
      limit,
    });
    return adminNoIndex(success({ entries }));
  } catch (error) {
    return adminNoIndex(routeError(error));
  }
}

