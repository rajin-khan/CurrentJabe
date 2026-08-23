import { NextRequest } from "next/server";
import { routeError, success } from "@/lib/server/http";
import { attachVisitorCookie, getOrCreateVisitor } from "@/lib/server/visitor";

export async function GET(request: NextRequest) {
  try {
    const identity = getOrCreateVisitor(request);
    const response = success({ visitorReady: true });
    attachVisitorCookie(response, identity);
    return response;
  } catch (error) {
    return routeError(error);
  }
}

