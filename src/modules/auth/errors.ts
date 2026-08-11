/**
 * Typed authz failures for server/API guards.
 * Call sites map these to redirect or HTTP status codes.
 */

export class AuthError extends Error {
  readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "INACTIVE" | "RATE_LIMITED";

  constructor(
    code: "UNAUTHORIZED" | "FORBIDDEN" | "INACTIVE" | "RATE_LIMITED",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
