import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { eq, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";

import { getDb } from "@/db";
import { controlPanelLoginAttempts, controlPanelSessions } from "@/db/schema";

const COOKIE_NAME = "osu_pulse_control";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const MAX_ATTEMPTS = 5;

function authSecret() {
  const value = process.env.CONTROL_PANEL_SESSION_SECRET ?? process.env.INTERNAL_API_SECRET;
  if (!value || value.length < 32) {
    throw new Error("CONTROL_PANEL_SESSION_SECRET must contain at least 32 characters");
  }
  return value;
}

function hmac(value: string) {
  return createHmac("sha256", authSecret()).update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(hmac(left));
  const b = Buffer.from(hmac(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function expectedKeyphrase() {
  const value = process.env.CONTROL_PANEL_KEYPHRASE ?? process.env.WEB_RENDER_ACCESS_KEY;
  if (!value) throw new Error("CONTROL_PANEL_KEYPHRASE is not configured");
  return value;
}

export function verifyKeyphrase(value: string) {
  return safeEqual(value, expectedKeyphrase());
}

export async function requestFingerprint() {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = requestHeaders.get("user-agent") ?? "unknown";
  return hmac(`${forwarded}|${userAgent}`);
}

export async function loginAllowed(fingerprintHash: string) {
  const row = await getDb().query.controlPanelLoginAttempts.findFirst({
    where: eq(controlPanelLoginAttempts.fingerprintHash, fingerprintHash),
  });
  return !row?.lockedUntil || row.lockedUntil.getTime() <= Date.now();
}

export async function registerLoginFailure(fingerprintHash: string) {
  const db = getDb();
  const now = new Date();
  const current = await db.query.controlPanelLoginAttempts.findFirst({
    where: eq(controlPanelLoginAttempts.fingerprintHash, fingerprintHash),
  });
  const outsideWindow = !current || now.getTime() - current.windowStartedAt.getTime() > ATTEMPT_WINDOW_MS;
  const failedAttempts = outsideWindow ? 1 : current.failedAttempts + 1;
  const values = {
    fingerprintHash,
    failedAttempts,
    windowStartedAt: outsideWindow ? now : current.windowStartedAt,
    lockedUntil: failedAttempts >= MAX_ATTEMPTS ? new Date(now.getTime() + ATTEMPT_WINDOW_MS) : null,
    updatedAt: now,
  };
  await db.insert(controlPanelLoginAttempts).values(values).onConflictDoUpdate({
    target: controlPanelLoginAttempts.fingerprintHash,
    set: values,
  });
}

export async function clearLoginFailures(fingerprintHash: string) {
  await getDb().delete(controlPanelLoginAttempts).where(
    eq(controlPanelLoginAttempts.fingerprintHash, fingerprintHash),
  );
}

export async function createControlPanelSession() {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1_000);
  await getDb().insert(controlPanelSessions).values({
    tokenHash: hmac(token),
    expiresAt,
    createdAt: now,
    lastSeenAt: now,
  });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
    priority: "high",
  });
}

export async function getControlPanelSession() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const tokenHash = hmac(token);
  const row = await getDb().query.controlPanelSessions.findFirst({
    where: eq(controlPanelSessions.tokenHash, tokenHash),
  });
  if (!row || row.expiresAt.getTime() <= Date.now()) {
    if (row) await getDb().delete(controlPanelSessions).where(eq(controlPanelSessions.tokenHash, tokenHash));
    return null;
  }
  return { tokenHash, expiresAt: row.expiresAt.toISOString() };
}

export async function hasControlPanelSession() {
  return Boolean(await getControlPanelSession());
}

export async function deleteControlPanelSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await getDb().delete(controlPanelSessions).where(eq(controlPanelSessions.tokenHash, hmac(token)));
  }
  cookieStore.delete(COOKIE_NAME);
}

export async function cleanupExpiredControlPanelSessions() {
  await getDb().delete(controlPanelSessions).where(lt(controlPanelSessions.expiresAt, new Date()));
}
