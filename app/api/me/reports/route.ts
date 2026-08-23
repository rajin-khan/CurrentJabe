import { NextRequest } from "next/server";
import { ValidationError } from "@/lib/domain/validation";
import { assertSameOrigin, readJson, routeError, success } from "@/lib/server/http";
import { deleteVisitorData } from "@/lib/server/reports";
import { expireVisitorCookie, getOrCreateVisitor } from "@/lib/server/visitor";

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const value = await readJson(request);
    if (!value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).confirm !== true) {
      throw new ValidationError("Set confirm to true to delete this browser's community reports.");
    }
    const identity = getOrCreateVisitor(request);
    const data = await deleteVisitorData(identity.visitorHash, identity.ipHash);
    const response = success({
      ...data,
      reportsDeleted: data.outageEvents + data.statusConfirmations,
      dailySubmissionsDeleted: data.dailySubmissions,
      identityReset: true,
    });
    expireVisitorCookie(response);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
