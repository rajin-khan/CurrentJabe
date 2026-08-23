import "server-only";

import {
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { HttpError } from "./http";

export const ADMIN_COOKIE = "cj_admin";
const SESSION_SECONDS = 8 * 60 * 60;

type AdminSession = { u: string; iat: number; exp: number; n: string };

function sessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new HttpError(503, "admin_not_configured", "Admin session security is not configured.");
  }
  return secret;
}

function configuredUsername(): string {
  const username = process.env.ADMIN_USERNAME;
  if (!username) throw new HttpError(503, "admin_not_configured", "Admin credentials are not configured.");
  return username;
}

function safeEqualText(left: string, right: string): boolean {
  const leftDigest = createHmac("sha256", sessionSecret()).update(left).digest();
  const rightDigest = createHmac("sha256", sessionSecret()).update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function verifyPassword(password: string): boolean {
  const encoded = process.env.ADMIN_PASSWORD_HASH;
  if (!encoded) throw new HttpError(503, "admin_not_configured", "Admin credentials are not configured.");
  const [algorithm, iterationText, saltText, expectedText] = encoded.split("$");
  const iterations = Number(iterationText);
  if (
    algorithm !== "pbkdf2_sha256" ||
    !Number.isInteger(iterations) ||
    iterations < 200_000 ||
    !saltText ||
    !expectedText
  ) {
    throw new HttpError(503, "admin_not_configured", "ADMIN_PASSWORD_HASH has an invalid format.");
  }
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(expectedText, "base64url");
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, "sha256");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function authenticateCredentials(username: string, password: string): boolean {
  const validUsername = safeEqualText(username, configuredUsername());
  const validPassword = verifyPassword(password);
  return validUsername && validPassword;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createAdminSession(response: NextResponse): void {
  const now = Math.floor(Date.now() / 1000);
  const session: AdminSession = {
    u: configuredUsername(),
    iat: now,
    exp: now + SESSION_SECONDS,
    n: randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  response.cookies.set(ADMIN_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export function clearAdminSession(response: NextResponse): void {
  response.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export function requireAdmin(request: NextRequest): { username: string } {
  const value = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!value) throw new HttpError(401, "admin_unauthorized", "Admin authentication required.");
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !safeEqualText(signature, sign(payload))) {
    throw new HttpError(401, "admin_unauthorized", "Admin session is invalid.");
  }
  let session: AdminSession;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminSession;
  } catch {
    throw new HttpError(401, "admin_unauthorized", "Admin session is invalid.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    session.u !== configuredUsername() ||
    !Number.isInteger(session.iat) ||
    !Number.isInteger(session.exp) ||
    session.exp <= now ||
    session.iat > now + 60
  ) {
    throw new HttpError(401, "admin_unauthorized", "Admin session has expired.");
  }
  return { username: session.u };
}
