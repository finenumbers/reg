import { afterEach, describe, expect, it } from "vitest";
import {
  assertServerEnvAtStartup,
  resetServerEnvCacheForTests,
  tryValidateServerEnv,
} from "@/lib/env";

const EXAMPLE_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function setValidEnv(overrides: Record<string, string | undefined> = {}) {
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = overrides.NODE_ENV ?? "development";
  env.DATABASE_URL =
    overrides.DATABASE_URL ?? "postgresql://reg:reg@localhost:5432/reg";
  env.BETTER_AUTH_SECRET =
    overrides.BETTER_AUTH_SECRET ?? "a".repeat(32);
  env.BETTER_AUTH_URL =
    overrides.BETTER_AUTH_URL ?? "http://localhost:3000";
  env.APP_ENCRYPTION_KEY =
    overrides.APP_ENCRYPTION_KEY ??
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
}

describe("server env validation", () => {
  afterEach(() => {
    resetServerEnvCacheForTests();
  });

  it("accepts a valid development env", () => {
    setValidEnv();
    const result = tryValidateServerEnv();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.DATABASE_URL).toContain("postgresql://");
    }
  });

  it("rejects short BETTER_AUTH_SECRET", () => {
    setValidEnv({ BETTER_AUTH_SECRET: "short" });
    const result = tryValidateServerEnv();
    expect(result.ok).toBe(false);
  });

  it("rejects invalid APP_ENCRYPTION_KEY length", () => {
    setValidEnv({ APP_ENCRYPTION_KEY: "abcd" });
    const result = tryValidateServerEnv();
    expect(result.ok).toBe(false);
  });

  it("rejects example encryption key in production", () => {
    setValidEnv({
      NODE_ENV: "production",
      APP_ENCRYPTION_KEY: EXAMPLE_KEY,
      BETTER_AUTH_SECRET: "x".repeat(40),
      BETTER_AUTH_URL: "https://regs.example.com",
    });
    const result = tryValidateServerEnv();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/APP_ENCRYPTION_KEY/);
    }
  });

  it("rejects placeholder BETTER_AUTH_SECRET in production", () => {
    setValidEnv({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "change-me-to-a-long-random-secret-at-least-32",
      BETTER_AUTH_URL: "https://regs.example.com",
    });
    const result = tryValidateServerEnv();
    expect(result.ok).toBe(false);
  });

  it("assertServerEnvAtStartup caches env", () => {
    setValidEnv();
    const a = assertServerEnvAtStartup();
    expect(a.env.DATABASE_URL).toContain("postgresql://");
  });
});
