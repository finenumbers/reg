import { beforeEach, describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "@/lib/rate-limit";

describe("SlidingWindowRateLimiter", () => {
  let limiter: SlidingWindowRateLimiter;

  beforeEach(() => {
    limiter = new SlidingWindowRateLimiter(3, 1000);
  });

  it("allows up to the limit then blocks", () => {
    expect(limiter.check("k", 100).allowed).toBe(true);
    expect(limiter.check("k", 200).allowed).toBe(true);
    expect(limiter.check("k", 300).allowed).toBe(true);
    const blocked = limiter.check("k", 400);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets after the window", () => {
    expect(limiter.check("k", 0).allowed).toBe(true);
    expect(limiter.check("k", 10).allowed).toBe(true);
    expect(limiter.check("k", 20).allowed).toBe(true);
    expect(limiter.check("k", 30).allowed).toBe(false);
    expect(limiter.check("k", 1010).allowed).toBe(true);
  });

  it("isolates keys", () => {
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
  });
});
