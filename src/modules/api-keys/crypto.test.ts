import { describe, expect, it } from "vitest";
import {
  apiKeyPrefix,
  extractApiKeyFromHeaders,
  generateApiKeySecret,
  hashApiKey,
  hasApiKeyHeader,
  verifyApiKeyHash,
} from "@/modules/api-keys/crypto";
import { apiKeyRateLimiter, SlidingWindowRateLimiter } from "@/lib/rate-limit";

describe("api key crypto", () => {
  it("generates reg_ secrets with stable prefix + verifiable hash", () => {
    const secret = generateApiKeySecret();
    expect(secret.startsWith("reg_")).toBe(true);
    expect(apiKeyPrefix(secret)).toHaveLength(12);
    const hash = hashApiKey(secret);
    expect(hash).toHaveLength(64);
    expect(verifyApiKeyHash(secret, hash)).toBe(true);
    expect(verifyApiKeyHash(secret + "x", hash)).toBe(false);
  });

  it("extracts Bearer and X-Api-Key headers", () => {
    const bearer = new Headers({ authorization: "Bearer reg_abc" });
    expect(extractApiKeyFromHeaders(bearer)).toBe("reg_abc");
    expect(hasApiKeyHeader(bearer)).toBe(true);

    const x = new Headers({ "x-api-key": "reg_xyz" });
    expect(extractApiKeyFromHeaders(x)).toBe("reg_xyz");
    expect(hasApiKeyHeader(x)).toBe(true);

    const both = new Headers({
      authorization: "Bearer reg_preferred",
      "x-api-key": "reg_other",
    });
    expect(extractApiKeyFromHeaders(both)).toBe("reg_preferred");

    expect(extractApiKeyFromHeaders(new Headers())).toBeNull();
    expect(hasApiKeyHeader(new Headers())).toBe(false);
  });

  it("ignores Bearer values that are not platform API keys", () => {
    const foreign = new Headers({ authorization: "Bearer not-a-platform-key" });
    expect(extractApiKeyFromHeaders(foreign)).toBeNull();
    expect(hasApiKeyHeader(foreign)).toBe(false);
    const x = new Headers({ "x-api-key": "sk-other" });
    expect(extractApiKeyFromHeaders(x)).toBeNull();
  });
});

describe("apiKeyRateLimiter", () => {
  it("allows bursts under 10k/min and rejects when exhausted", () => {
    const limiter = new SlidingWindowRateLimiter(2, 60_000);
    expect(limiter.check("k1").allowed).toBe(true);
    expect(limiter.check("k1").allowed).toBe(true);
    expect(limiter.check("k1").allowed).toBe(false);

    apiKeyRateLimiter.reset();
    expect(apiKeyRateLimiter.check("smoke").allowed).toBe(true);
    apiKeyRateLimiter.reset();
  });
});
