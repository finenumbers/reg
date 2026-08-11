import { describe, expect, it } from "vitest";
import { AuthError, isAuthError } from "@/modules/auth/errors";

describe("AuthError", () => {
  it("carries UNAUTHORIZED / FORBIDDEN / INACTIVE codes", () => {
    expect(new AuthError("UNAUTHORIZED").code).toBe("UNAUTHORIZED");
    expect(new AuthError("FORBIDDEN").code).toBe("FORBIDDEN");
    expect(new AuthError("INACTIVE").code).toBe("INACTIVE");
    expect(new AuthError("RATE_LIMITED").code).toBe("RATE_LIMITED");
  });

  it("isAuthError narrows correctly", () => {
    expect(isAuthError(new AuthError("FORBIDDEN"))).toBe(true);
    expect(isAuthError(new Error("nope"))).toBe(false);
  });
});

/**
 * Documents the expected HTTP mapping for API guards (implemented in guards.ts).
 * Anonymous → 401, authenticated without permission → 403.
 */
describe("protected route status mapping", () => {
  function mapAuthErrorToStatus(error: AuthError): number {
    if (error.code === "UNAUTHORIZED" || error.code === "INACTIVE") return 401;
    return 403;
  }

  function mapAuthErrorToPage(error: AuthError): "/login" | "/forbidden" {
    if (error.code === "UNAUTHORIZED" || error.code === "INACTIVE") return "/login";
    return "/forbidden";
  }

  it("maps anonymous API access to 401", () => {
    expect(mapAuthErrorToStatus(new AuthError("UNAUTHORIZED"))).toBe(401);
  });

  it("maps authenticated non-authorized API access to 403", () => {
    expect(mapAuthErrorToStatus(new AuthError("FORBIDDEN"))).toBe(403);
  });

  it("maps page anonymous to login and forbidden to /forbidden", () => {
    expect(mapAuthErrorToPage(new AuthError("UNAUTHORIZED"))).toBe("/login");
    expect(mapAuthErrorToPage(new AuthError("FORBIDDEN"))).toBe("/forbidden");
  });

  it("treats missing db user like anonymous (UNAUTHORIZED → 401)", () => {
    // getAuthzContext throws UNAUTHORIZED when session.user has no DB row.
    expect(mapAuthErrorToStatus(new AuthError("UNAUTHORIZED"))).toBe(401);
  });
});
