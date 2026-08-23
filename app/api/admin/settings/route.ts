import { NextRequest } from "next/server";
import { ValidationError } from "@/lib/domain/validation";
import { requireAdmin } from "@/lib/server/admin-auth";
import { adminNoIndex, assertSameOrigin, readJson, routeError, success } from "@/lib/server/http";
import { restRpc, restSelect } from "@/lib/server/supabase-rest";

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const rows = await restSelect<unknown[]>("app_settings", { select: "*", singleton: "eq.true", limit: 1 });
    return adminNoIndex(success({ settings: rows[0] ?? null }));
  } catch (error) {
    return adminNoIndex(routeError(error));
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const admin = requireAdmin(request);
    const patch = await readJson(request);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new ValidationError("Request body must be an object.");
    const settings = await restRpc("admin_update_settings", { p_patch: patch, p_actor: admin.username });
    return adminNoIndex(success({ settings }));
  } catch (error) {
    return adminNoIndex(routeError(error));
  }
}

