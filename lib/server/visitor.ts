import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { HttpError } from "./http";

export const VISITOR_COOKIE = "cj_visitor";
const VISITOR_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

export type VisitorIdentity = {
  visitorHash: string;
  ipHash: string;
  networkHash: string;
  rawToken: string;
  isNew: boolean;
};

function hashingSecret(): string {
  const value = process.env.VISITOR_HASH_SECRET;
  if (!value || value.length < 32) {
    throw new HttpError(503, "visitor_identity_not_configured", "Anonymous reporting security is not configured.");
  }
  return value;
}

function hmac(value: string, context: string): string {
  return createHmac("sha256", hashingSecret()).update(`${context}\0${value}`).digest("base64url");
}

function requestIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unavailable";
}

function dhakaDayKey(now = new Date()): string {
  const shifted = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function getOrCreateVisitor(request: NextRequest): VisitorIdentity {
  const existing = request.cookies.get(VISITOR_COOKIE)?.value;
  const validExisting = existing && TOKEN_PATTERN.test(existing) ? existing : null;
  const rawToken = validExisting ?? randomBytes(32).toString("base64url");
  const ip = requestIp(request);
  return {
    rawToken,
    visitorHash: hmac(rawToken, "visitor"),
    ipHash: hmac(ip, "ip"),
    // This value is useful only for short-horizon contribution diversity. The
    // Dhaka-day rotation prevents it becoming a durable network identifier.
    networkHash: hmac(`${dhakaDayKey()}\0${ip}`, "network-day"),
    isNew: !validExisting,
  };
}

export function attachVisitorCookie(response: NextResponse, identity: VisitorIdentity): void {
  if (!identity.isNew) return;
  response.cookies.set(VISITOR_COOKIE, identity.rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE,
  });
}

export function expireVisitorCookie(response: NextResponse): void {
  response.cookies.set(VISITOR_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}
