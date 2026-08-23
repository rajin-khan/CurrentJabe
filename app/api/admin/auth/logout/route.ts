import { NextRequest } from "next/server";
import { clearAdminSession } from "@/lib/server/admin-auth";
import { adminNoIndex, assertSameOrigin, routeError, success } from "@/lib/server/http";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const response = success({ authenticated: false });
    clearAdminSession(response);
    return adminNoIndex(response);
  } catch (error) {
    return adminNoIndex(routeError(error));
  }
}

