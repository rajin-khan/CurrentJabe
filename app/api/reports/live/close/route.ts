import { NextRequest } from "next/server";
import { validateUuid, ValidationError } from "@/lib/domain/validation";
import { assertSameOrigin, readJson, routeError, success } from "@/lib/server/http";
import { closeLiveOutage } from "@/lib/server/reports";
import { attachVisitorCookie, getOrCreateVisitor } from "@/lib/server/visitor";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const value = await readJson(request);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ValidationError("Request body must be an object.");
    }
    const eventId = validateUuid((value as Record<string, unknown>).eventId, "eventId");
    const identity = getOrCreateVisitor(request);
    const data = await closeLiveOutage({
      visitorHash: identity.visitorHash,
      ipHash: identity.ipHash,
      networkHash: identity.networkHash,
      eventId,
    });
    const response = success(data);
    attachVisitorCookie(response, identity);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
