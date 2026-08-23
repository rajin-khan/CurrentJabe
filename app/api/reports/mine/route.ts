import { NextRequest } from "next/server";
import { isTodayOrYesterdayInDhaka, validateLocation, ValidationError } from "@/lib/domain/validation";
import { getMyReports } from "@/lib/server/reports";
import { routeError, success } from "@/lib/server/http";
import { attachVisitorCookie, getOrCreateVisitor } from "@/lib/server/visitor";

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams;
    const date = search.get("date");
    if (!date || !isTodayOrYesterdayInDhaka(date)) {
      throw new ValidationError("date must be today or yesterday in Bangladesh time.");
    }
    const location = validateLocation({
      upazilaId: search.get("upazilaId"),
      providerId: search.get("providerId") || undefined,
      feederId: search.get("feederId") || undefined,
    });
    const identity = getOrCreateVisitor(request);
    const data = await getMyReports({ visitorHash: identity.visitorHash, date, location });
    const response = success(data);
    attachVisitorCookie(response, identity);
    return response;
  } catch (error) {
    return routeError(error);
  }
}

