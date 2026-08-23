import { NextRequest } from "next/server";
import { isLocationId } from "@/lib/domain/location";
import { ValidationError } from "@/lib/domain/validation";
import { isAnalyticsEvent, recordAnalytics } from "@/lib/server/analytics";
import { ensureLocationSelection } from "@/lib/server/catalog-seed";
import { assertSameOrigin, readJson, routeError, success } from "@/lib/server/http";
import { attachVisitorCookie, getOrCreateVisitor } from "@/lib/server/visitor";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const value = await readJson(request);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ValidationError("Request body must be an object.");
    }
    const body = value as Record<string, unknown>;
    if (!isAnalyticsEvent(body.event)) throw new ValidationError("event is not an accepted operational event.");
    if (body.upazilaId !== undefined && !isLocationId(body.upazilaId)) {
      throw new ValidationError("upazilaId is invalid.");
    }
    const identity = getOrCreateVisitor(request);
    if (typeof body.upazilaId === "string") {
      await ensureLocationSelection({ upazilaId: body.upazilaId });
    }
    await recordAnalytics({
      event: body.event,
      visitorHash: identity.visitorHash,
      ipHash: identity.ipHash,
      ...(typeof body.upazilaId === "string" ? { upazilaId: body.upazilaId } : {}),
    });
    const response = success({ recorded: true });
    attachVisitorCookie(response, identity);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
