import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { username } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { prisma } from "@/lib/db";
import { loginRateLimiter } from "@/lib/rate-limit";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";

function clientIp(headers: Headers | undefined): string | null {
  if (!headers) return null;
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded && process.env.BETTER_AUTH_URL?.startsWith("https://")) {
    const hops = forwarded
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    // Prefer the hop closest to our edge (last), not the spoofable first.
    if (hops.length > 0) return hops[hops.length - 1]!;
  }

  return null;
}

/**
 * Better Auth server instance.
 * Prisma auth model names/fields are generated via:
 *   npm run auth:generate
 * Do not invent a custom auth schema — regenerate from this config.
 *
 * Primary login identifier: username (username plugin).
 * Public sign-up is disabled — first admin comes from env bootstrap.
 */
function publicOrigin(): string | undefined {
  const url = process.env.BETTER_AUTH_URL;
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  // Public origin behind NPM must be trusted for Better Auth CSRF/origin checks.
  trustedOrigins: [publicOrigin()].filter((v): v is string => Boolean(v)),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      isActive: {
        type: "boolean",
        defaultValue: true,
        required: false,
        input: false,
      },
    },
  },
  // Secure cookies when BETTER_AUTH_URL is https (typical behind NPM).
  // trustedProxyHeaders default helps resolve client IP / host via X-Forwarded-*.
  advanced: {
    useSecureCookies: process.env.BETTER_AUTH_URL?.startsWith("https://") === true,
  },
  plugins: [username(), nextCookies()],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/username") {
        const ip = clientIp(ctx.headers) ?? "unknown";
        const limited = loginRateLimiter.check(`login:${ip}`);
        if (!limited.allowed) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Too many login attempts. Try again later.",
          });
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      const ip = clientIp(ctx.headers);

      if (ctx.path === "/sign-in/username") {
        const newSession = ctx.context.newSession;
        if (newSession) {
          await auditService.append({
            actorUserId: newSession.user.id,
            action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
            entityType: "user",
            entityId: newSession.user.id,
            meta: {
              method: "username",
              username:
                (newSession.user as { username?: string | null }).username ??
                null,
            },
            ip,
          });
          return;
        }

        // Failed sign-in: after hook may still run with an APIError result.
        const returned = ctx.context.returned;
        if (returned instanceof APIError || (returned && typeof returned === "object" && "status" in returned)) {
          const body = ctx.body as { username?: string } | undefined;
          await auditService.append({
            actorUserId: null,
            action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
            entityType: "user",
            meta: {
              method: "username",
              username: body?.username?.toLowerCase() ?? null,
            },
            ip,
          });
        }
      }

      if (ctx.path === "/sign-out") {
        const session = ctx.context.session;
        await auditService.append({
          actorUserId: session?.user?.id ?? null,
          action: AUDIT_ACTIONS.AUTH_LOGOUT,
          entityType: "user",
          entityId: session?.user?.id,
          meta: { method: "session" },
          ip,
        });
      }
    }),
  },
});
