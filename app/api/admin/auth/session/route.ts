import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/admin-auth";
import { adminNoIndex, routeError, success } from "@/lib/server/http";

export async function GET(request: NextRequest) {
  try {
    const admin = requireAdmin(request);
    return adminNoIndex(success({ authenticated: true, username: admin.username }));
  } catch (error) {
    return adminNoIndex(routeError(error));
  }
}

