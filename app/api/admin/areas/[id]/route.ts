import { NextRequest } from "next/server";
import { catalogLocationById } from "@/lib/domain/catalog";
import { isLocationId } from "@/lib/domain/location";
import { ValidationError } from "@/lib/domain/validation";
import { requireAdmin } from "@/lib/server/admin-auth";
import { ensureLocationSelection } from "@/lib/server/catalog-seed";
import { adminNoIndex, assertSameOrigin, readJson, routeError, success } from "@/lib/server/http";
import { restRpc } from "@/lib/server/supabase-rest";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const admin = requireAdmin(request);
    const { id } = await params;
    if (!isLocationId(id)) throw new ValidationError("Area id is invalid.");
    await ensureLocationSelection({ upazilaId: id });
    const patch = await readJson(request);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new ValidationError("Request body must be an object.");
    const bundled = catalogLocationById(id);
    const allowedKeys = new Set([
      "disabled",
      "disableReason",
      "providerMappings",
      ...(bundled ? [] : ["nameEn", "nameBn"]),
    ]);
    const unsupportedKeys = Object.keys(patch).filter((key) => !allowedKeys.has(key));
    if (unsupportedKeys.length > 0) {
      throw new ValidationError(
        bundled
          ? "Bundled location names and map coverage are managed by the versioned geographic catalog."
          : "Map coverage must be updated atomically in the versioned geographic catalog.",
      );
    }
    const area = await restRpc("admin_update_area", {
      p_upazila_id: id,
      p_patch: patch,
      p_actor: admin.username,
    });
    return adminNoIndex(success(area));
  } catch (error) {
    return adminNoIndex(routeError(error));
  }
}
