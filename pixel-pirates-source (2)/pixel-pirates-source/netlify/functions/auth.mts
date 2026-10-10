import type { Config } from "@netlify/functions";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { authCodes, passwordResetGrants, sessions, users } from "../../db/schema.js";
import { clearSession, codeHash, codeMatches, createCode, createSession, digest, enforceRateLimit, hashPassword, keyedDigest, requireUser, assertSameOrigin, verifyPassword } from "../../lib/auth.js";
import { codeSchema, emailSchema, resetPasswordSchema, signInSchema, signUpSchema } from "../../lib/auth-validation.js";
import { sendSecurityCode } from "../../lib/email.js";
import { handle, HttpError, json, parseBody } from "../../lib/http.js";

const CODE_LIFETIME_MS = 10 * 60 * 1000;
const RESET_LIFETIME_MS = 10 * 60 * 1000;
const GENERIC_RECOVERY_MESSAGE = "If an eligible account matches that email, recovery instructions will be sent.";
const GENERIC_SIGNIN_ERROR = "Email or password is incorrect, or the email address has not been verified.";

function clientIp(request: Request) {
  return request.headers.get("x-nf-client-connection-ip") ?? "unknown";
}

async function issueCode(userId: number, email: string, purpose: "verification" | "recovery") {
  const code = createCode();
  const now = new Date();
  await db.update(authCodes)
    .set({ consumedAt: now })
    .where(and(eq(authCodes.userId, userId), eq(authCodes.purpose, purpose), isNull(authCodes.consumedAt)));
  await db.insert(authCodes).values({ userId, purpose, codeHash: codeHash(code), expiresAt: new Date(now.getTime() + CODE_LIFETIME_MS) });
  await sendSecurityCode(email, code, purpose);
}

async function validateCode(email: string, code: string, purpose: "verification" | "recovery") {
  const [account] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!account) throw new HttpError(400, "The code is invalid or expired. Request a new code and try again.");
  const [challenge] = await db.select().from(authCodes)
    .where(and(eq(authCodes.userId, account.id), eq(authCodes.purpose, purpose), isNull(authCodes.consumedAt)))
    .orderBy(desc(authCodes.createdAt)).limit(1);
  if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= 5) {
    throw new HttpError(400, "The code is invalid or expired. Request a new code and try again.");
  }
  if (!codeMatches(code, challenge.codeHash)) {
    await db.update(authCodes).set({ attempts: sql`${authCodes.attempts} + 1` }).where(and(eq(authCodes.id, challenge.id), isNull(authCodes.consumedAt)));
    throw new HttpError(400, "The code is invalid or expired. Request a new code and try again.");
  }
  const [consumed] = await db.update(authCodes).set({ consumedAt: new Date() })
    .where(and(eq(authCodes.id, challenge.id), isNull(authCodes.consumedAt), gt(authCodes.expiresAt, new Date())))
    .returning({ id: authCodes.id });
  if (!consumed) throw new HttpError(400, "The code is invalid or expired. Request a new code and try again.");
  return account;
}

export default handle(async (request: Request) => {
  const path = new URL(request.url).pathname;
  if (request.method !== "GET") assertSameOrigin(request);

  if (path === "/api/auth/session" && request.method === "GET") {
    try {
      const user = await requireUser(request);
      return json({ user });
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) return json({ user: null });
      throw error;
    }
  }

  if (path === "/api/auth/signup" && request.method === "POST") {
    await enforceRateLimit(request, "signup", "ip", 5, 60 * 60 * 1000);
    const input = await parseBody(request, signUpSchema);
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      throw new HttpError(503, "Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM before creating an account.");
    }
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing.length) throw new HttpError(409, "An account could not be created with that email address.");
    if (input.backupEmail && input.backupEmail === input.email) {
      throw new HttpError(422, "Backup email must be different from your primary email", { fields: { backupEmail: "Use a different email address" } });
    }
    await enforceRateLimit(request, "signup-email", input.email, 3, 60 * 60 * 1000);
    const passwordHash = await hashPassword(input.password);
    const [account] = await db.insert(users).values({
      fullName: input.fullName,
      email: input.email,
      backupEmail: input.backupEmail ?? null,
      passwordHash,
      emailUpdates: input.emailUpdates,
    }).returning({ id: users.id, email: users.email });
    try {
      await issueCode(account.id, account.email, "verification");
    } catch (error) {
      await db.delete(users).where(eq(users.id, account.id));
      throw error;
    }
    return json({ message: "Check your primary email for a verification code.", email: account.email }, 201);
  }

  if (path === "/api/auth/verify-email" && request.method === "POST") {
    const input = await parseBody(request, codeSchema);
    await enforceRateLimit(request, "verify-email", input.email, 10, 15 * 60 * 1000);
    const account = await validateCode(input.email, input.code, "verification");
    const [verified] = await db.update(users).set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, account.id), isNull(users.emailVerifiedAt)))
      .returning({ id: users.id });
    if (!verified && !account.emailVerifiedAt) throw new HttpError(400, "The code is invalid or expired. Request a new code and try again.");
    const cookie = await createSession(account.id);
    return json({ message: "Email verified.", redirect: "/dashboard" }, 200, cookie);
  }

  if (path === "/api/auth/resend-verification" && request.method === "POST") {
    const input = await parseBody(request, emailSchema);
    await enforceRateLimit(request, "resend-verification", input.email, 3, 15 * 60 * 1000);
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      throw new HttpError(503, "Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM before using account email flows.");
    }
    const [account] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (account && !account.emailVerifiedAt) await issueCode(account.id, account.email, "verification");
    return json({ message: "If the account needs verification, a new code has been sent." });
  }

  if (path === "/api/auth/signin" && request.method === "POST") {
    const input = await parseBody(request, signInSchema);
    await enforceRateLimit(request, "signin-ip", "ip", 12, 15 * 60 * 1000);
    await enforceRateLimit(request, "signin-email", input.email, 6, 15 * 60 * 1000);
    const [account] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const matches = account ? await verifyPassword(input.password, account.passwordHash) : false;
    if (!account || !matches || !account.emailVerifiedAt) throw new HttpError(401, GENERIC_SIGNIN_ERROR);
    const cookie = await createSession(account.id);
    return json({ user: { id: account.id, fullName: account.fullName, email: account.email }, redirect: "/dashboard" }, 200, cookie);
  }

  if (path === "/api/auth/signout" && request.method === "POST") {
    const cookie = await clearSession(request);
    return json({ ok: true }, 200, cookie);
  }

  if (path === "/api/auth/forgot-password" && request.method === "POST") {
    const input = await parseBody(request, emailSchema);
    await enforceRateLimit(request, "forgot-password-ip", "ip", 8, 60 * 60 * 1000);
    await enforceRateLimit(request, "forgot-password-email", input.email, 3, 60 * 60 * 1000);
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      throw new HttpError(503, "Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM before using account recovery.");
    }
    const [account] = await db.select().from(users).where(and(eq(users.email, input.email), gt(users.emailVerifiedAt, new Date(0)))).limit(1);
    if (account) {
      const code = createCode();
      const now = new Date();
      await db.update(authCodes).set({ consumedAt: now })
        .where(and(eq(authCodes.userId, account.id), eq(authCodes.purpose, "recovery"), isNull(authCodes.consumedAt)));
      await db.insert(authCodes).values({ userId: account.id, purpose: "recovery", codeHash: codeHash(code), expiresAt: new Date(now.getTime() + CODE_LIFETIME_MS) });
      try {
        await sendSecurityCode(account.email, code, "recovery");
        if (account.backupEmailVerifiedAt && account.backupEmail) await sendSecurityCode(account.backupEmail, code, "recovery");
      } catch (error) {
        console.error("Password recovery email delivery failed");
      }
    }
    return json({ message: GENERIC_RECOVERY_MESSAGE });
  }

  if (path === "/api/auth/verify-reset" && request.method === "POST") {
    const input = await parseBody(request, codeSchema);
    await enforceRateLimit(request, "verify-reset", input.email, 10, 15 * 60 * 1000);
    const account = await validateCode(input.email, input.code, "recovery");
    const resetToken = randomBytes(32).toString("base64url");
    await db.insert(passwordResetGrants).values({ userId: account.id, tokenHash: digest(resetToken), expiresAt: new Date(Date.now() + RESET_LIFETIME_MS) });
    return json({ resetToken, message: "Code verified. Choose a new password." });
  }

  if (path === "/api/auth/reset-password" && request.method === "POST") {
    const input = await parseBody(request, resetPasswordSchema);
    await enforceRateLimit(request, "reset-password", keyedDigest(input.resetToken), 5, 15 * 60 * 1000);
    const tokenHash = digest(input.resetToken);
    const [grant] = await db.select().from(passwordResetGrants)
      .where(and(eq(passwordResetGrants.tokenHash, tokenHash), isNull(passwordResetGrants.consumedAt), gt(passwordResetGrants.expiresAt, new Date())))
      .limit(1);
    if (!grant) throw new HttpError(400, "This reset session is invalid or expired. Request a new recovery code.");
    const passwordHash = await hashPassword(input.password);
    const [consumed] = await db.update(passwordResetGrants).set({ consumedAt: new Date() })
      .where(and(eq(passwordResetGrants.id, grant.id), isNull(passwordResetGrants.consumedAt), gt(passwordResetGrants.expiresAt, new Date())))
      .returning({ id: passwordResetGrants.id });
    if (!consumed) throw new HttpError(400, "This reset session is invalid or expired. Request a new recovery code.");
    await db.update(users).set({ passwordHash: passwordHash }).where(eq(users.id, grant.userId));
    await db.update(authCodes).set({ consumedAt: new Date() })
      .where(and(eq(authCodes.userId, grant.userId), eq(authCodes.purpose, "recovery"), isNull(authCodes.consumedAt)));
    await db.update(passwordResetGrants).set({ consumedAt: new Date() })
      .where(and(eq(passwordResetGrants.userId, grant.userId), isNull(passwordResetGrants.consumedAt)));
    await db.delete(sessions).where(eq(sessions.userId, grant.userId));
    return json({ message: "Password updated. Sign in with your new password.", redirect: "/signin" });
  }

  if (path.startsWith("/api/auth/") && request.method === "GET") {
    const user = await requireUser(request);
    return json({ user });
  }
  return json({ error: "Method not allowed" }, 405);
});

export const config: Config = {
  path: [
    "/api/auth/session",
    "/api/auth/signup",
    "/api/auth/verify-email",
    "/api/auth/resend-verification",
    "/api/auth/signin",
    "/api/auth/signout",
    "/api/auth/forgot-password",
    "/api/auth/verify-reset",
    "/api/auth/reset-password",
  ],
};
