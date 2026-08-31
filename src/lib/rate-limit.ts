/**
 * Simple in-memory sliding-window rate limiter for sensitive endpoints.
 * Single-replica v1 assumption (same as in-process scheduler).
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const prev = this.hits.get(key) ?? [];
    const recent = prev.filter((t) => t > cutoff);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldest + this.windowMs - now) / 1000),
      );
      return { allowed: false, remaining: 0, retryAfterSec };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return {
      allowed: true,
      remaining: Math.max(0, this.limit - recent.length),
      retryAfterSec: 0,
    };
  }

  /** Test helper */
  reset(): void {
    this.hits.clear();
  }
}

/** Login attempts per IP: 10 / 5 minutes */
export const loginRateLimiter = new SlidingWindowRateLimiter(10, 5 * 60 * 1000);

/** Manual poll triggers per user: 6 / minute (anti-hammer; anti-overlap still applies) */
export const pollRateLimiter = new SlidingWindowRateLimiter(6, 60 * 1000);

/** SSH test triggers per user: 10 / minute */
export const sshTestRateLimiter = new SlidingWindowRateLimiter(10, 60 * 1000);

/** GeoIP connection test per user: 10 / minute */
export const geoipTestRateLimiter = new SlidingWindowRateLimiter(10, 60 * 1000);

/** PSTN connection test per user: 10 / minute */
export const pstnTestRateLimiter = new SlidingWindowRateLimiter(10, 60 * 1000);

/** Enrich uploads per user: 6 / minute */
export const enrichStartRateLimiter = new SlidingWindowRateLimiter(6, 60 * 1000);

/** Month traffic XLSX export starts per user: 6 / minute */
export const trafficExportStartRateLimiter = new SlidingWindowRateLimiter(
  6,
  60 * 1000,
);

/** VoIPmonitor connection test per user: 10 / minute */
export const voipmonitorTestRateLimiter = new SlidingWindowRateLimiter(
  10,
  60 * 1000,
);

/** Machine API key reads: 10_000 / minute per key (single-replica) */
export const apiKeyRateLimiter = new SlidingWindowRateLimiter(10_000, 60 * 1000);

/** CDR month purge starts per admin: 3 / minute */
export const storagePurgeRateLimiter = new SlidingWindowRateLimiter(
  3,
  60 * 1000,
);
