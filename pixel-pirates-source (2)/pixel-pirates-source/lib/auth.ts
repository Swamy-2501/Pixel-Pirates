import { createHash, createHmac, randomBytes, randomInt, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { authCodes, authRateLimits, sessions, users } from "../db/schema.js";
import { HttpError } from "./http.js";

const scrypt = promisify(nodeScrypt);
const SESSION_DAYS = 30;
const SESSION_COOKIE = "__Host-pp_session";

export type AuthUser = Pick<typeof users.$inferSelect, "id" | "fullName" | "email" | "backupEmail" | "emailVerifiedAt" | "emailUpdates">;

function authSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new HttpError(503, "Authentication is not configured. Set AUTH_SECRET to a random value of at least 32 characters.");
  return value;
}

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function keyedDigest(value: string) {
  return createHmac("sha256", authSecret()).update(value).digest("hex");
}

export function createCode() {
  return String(randomInt(100000, 1000000));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltHex, expectedHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltHex || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cookieToken(request: Request) {
  const cookies = request.headers.get("cookie") ?? "";
  const item = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return item ? decodeURIComponent(item.slice(SESSION_COOKIE.length + 1)) : undefined;
}

export async function requireUser(request: Request): Promise<AuthUser> {
  const token = cookieToken(request);
  if (!token) throw new HttpError(401, "Sign in to continue");
  const [row] = await db
    .select({ sessionId: sessions.id, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, digest(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row?.user.emailVerifiedAt) throw new HttpError(401, "Sign in to continue");
  const { id, fullName, email, backupEmail, emailVerifiedAt, emailUpdates } = row.user;
  return { id, fullName, email, backupEmail, emailVerifiedAt, emailUpdates };
}

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: digest(token), expiresAt });
  return {
    "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`,
  };
}

export async function clearSession(request: Request) {
  const token = cookieToken(request);
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, digest(token)));
  return { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` };
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) throw new HttpError(403, "Request origin is not allowed");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Request origin is not allowed");
}

export async function enforceRateLimit(request: Request, scope: string, identity: string, max: number, windowMs: number) {
  const clientIp = request.headers.get("x-nf-client-connection-ip") ?? "unknown";
  const key = keyedDigest(`${scope}:${clientIp}:${identity}`);
  const now = new Date();
  const resetBefore = new Date(now.getTime() - windowMs);
  const [row] = await db
    .insert(authRateLimits)
    .values({ key, windowStartedAt: now, count: 1 })
    .onConflictDoUpdate({
      target: authRateLimits.key,
      set: {
        count: sql`case when ${authRateLimits.windowStartedAt} <= ${resetBefore} then 1 else ${authRateLimits.count} + 1 end`,
        windowStartedAt: sql`case when ${authRateLimits.windowStartedAt} <= ${resetBefore} then ${now} else ${authRateLimits.windowStartedAt} end`,
      },
    })
    .returning({ count: authRateLimits.count });
  if (row.count > max) throw new HttpError(429, "Too many attempts. Please wait before trying again.");
}

export async function latestCode(userId: number, purpose: string) {
  const [row] = await db
    .select()
    .from(authCodes)
    .where(and(eq(authCodes.userId, userId), eq(authCodes.purpose, purpose), isNull(authCodes.consumedAt)))
    .orderBy(desc(authCodes.createdAt))
    .limit(1);
  return row;
}

export function codeMatches(code: string, expectedHex: string) {
  const actual = Buffer.from(keyedDigest(code), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const codeHash = keyedDigest;
