import { describe, expect, it } from "vitest";
import { redactLogFields } from "@/lib/logger";

describe("logger redaction", () => {
  it("redacts secret-like field names", () => {
    const out = redactLogFields({
      host: "x",
      password: "p",
      privateKey: "k",
      accessToken: "t",
      nested: { passphrase: "x", ok: true },
    }) as Record<string, unknown>;

    expect(out.host).toBe("x");
    expect(out.password).toBe("[REDACTED]");
    expect(out.privateKey).toBe("[REDACTED]");
    expect(out.accessToken).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).passphrase).toBe(
      "[REDACTED]",
    );
    expect((out.nested as Record<string, unknown>).ok).toBe(true);
  });
});
