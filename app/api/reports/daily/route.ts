import { NextRequest } from "next/server";
import { validateDailyReport } from "@/lib/domain/validation";
import { assertSameOrigin, readJson, routeError, success } from "@/lib/server/http";
import { submitDailyReport } from "@/lib/server/reports";
import { attachVisitorCookie, getOrCreateVisitor } from "@/lib/server/visitor";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const report = validateDailyReport(await readJson(request));
    const identity = getOrCreateVisitor(request);
    const data = await submitDailyReport({
      visitorHash: identity.visitorHash,
      ipHash: identity.ipHash,
      networkHash: identity.networkHash,
      report,
    });
    const response = success(data, { status: data.duplicate ? 200 : 201 });
    attachVisitorCookie(response, identity);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
