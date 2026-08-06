import { describe, expect, it } from "vitest";
import { authClient } from "@/modules/auth/auth-client";

/**
 * Username is the primary local login identifier (Better Auth username plugin).
 * This asserts the client exposes the username sign-in surface used by LoginForm.
 */
describe("username login client surface", () => {
  it("exposes authClient.signIn.username", () => {
    expect(typeof authClient.signIn.username).toBe("function");
  });

  it("exposes authClient.signOut for logout", () => {
    expect(typeof authClient.signOut).toBe("function");
  });
});
