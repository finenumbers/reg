import { describe, expect, it } from "vitest";
import { rejectsEmailSignIn } from "@/modules/auth/email-sign-in";

describe("rejectsEmailSignIn", () => {
  it("closes only the email sign-in route", () => {
    expect(rejectsEmailSignIn("/sign-in/email")).toBe(true);
    expect(rejectsEmailSignIn("/sign-in/username")).toBe(false);
    expect(rejectsEmailSignIn("/sign-up/email")).toBe(false);
  });
});
