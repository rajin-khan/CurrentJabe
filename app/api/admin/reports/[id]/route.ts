import { NextRequest } from "next/server";
import { validateUuid, ValidationError } from "@/lib/domain/validation";
import { requireAdmin } from "@/lib/server/admin-auth";
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
    const entityId = validateUuid(id);
    const value = await readJson(request);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Request body must be an object.");
    const body = value as Record<string, unknown>;
    if (!["daily_submission", "outage_event", "status_confirmation"].includes(String(body.entityType))) {
      throw new ValidationError("entityType is invalid.");
    }
    if (typeof body.suppressed !== "boolean") throw new ValidationError("suppressed must be true or false.");
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (body.suppressed && !reason) throw new ValidationError("A suppression reason is required.");

    const report = await restRpc("admin_set_report_suppression", {
      p_entity_type: body.entityType,
      p_entity_id: entityId,
      p_suppressed: body.suppressed,
      p_reason: reason || null,
      p_actor: admin.username,
    });
    return adminNoIndex(success({ report }));
  } catch (error) {
    return adminNoIndex(routeError(error));
  }
}

