import { NextRequest } from "next/server";
import { authenticateCredentials, createAdminSession } from "@/lib/server/admin-auth";
import { adminNoIndex, assertSameOrigin, failure, readJson, routeError, success } from "@/lib/server/http";
import { restRpc } from "@/lib/server/supabase-rest";
import { getOrCreateVisitor } from "@/lib/server/visitor";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const identity = getOrCreateVisitor(request);
    const reservation = await restRpc<{ allowed: boolean; attempt_id: number | null }>(
      "admin_reserve_login_attempt",
      { p_ip_hash: identity.ipHash },
    );
    if (!reservation.allowed || reservation.attempt_id === null) {
      return adminNoIndex(failure(429, "admin_login_limited", "Too many login attempts. Try again later."));
    }

    const value = await readJson(request);
    const body = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const username = typeof body.username === "string" ? body.username.slice(0, 160) : "";
    const password = typeof body.password === "string" ? body.password.slice(0, 1_024) : "";
    const authenticated = authenticateCredentials(username, password);
    await restRpc("admin_finish_login_attempt", {
      p_attempt_id: reservation.attempt_id,
      p_ip_hash: identity.ipHash,
      p_succeeded: authenticated,
    });
    if (!authenticated) return adminNoIndex(failure(401, "invalid_admin_credentials", "Invalid username or password."));

    const response = success({ authenticated: true });
    createAdminSession(response);
    return adminNoIndex(response);
  } catch (error) {
    return adminNoIndex(routeError(error));
  }
}
