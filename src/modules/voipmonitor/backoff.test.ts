import { describe, expect, it } from "vitest";
import {
  nextAttemptAt,
  nextAttemptAtForMiss,
} from "@/modules/voipmonitor/backoff";
import {
  MAX_MATCH_ATTEMPTS,
  QUEUE_EXHAUSTED_AT,
} from "@/modules/voipmonitor/constants";

const now = new Date("2026-08-29T12:00:00.000Z");

describe("nextAttemptAtForMiss", () => {
  it("parks exhausted not-found outside the due queue", () => {
    expect(
      nextAttemptAtForMiss(
        MAX_MATCH_ATTEMPTS,
        '{"miss_reason":"call_id_not_in_index"}',
        now,
      ),
    ).toEqual(QUEUE_EXHAUSTED_AT);
  });

  it("keeps assigned_elsewhere on the normal backoff", () => {
    expect(
      nextAttemptAtForMiss(
        MAX_MATCH_ATTEMPTS,
        '{"miss_reason":"assigned_elsewhere"}',
        now,
      ),
    ).toEqual(nextAttemptAt(MAX_MATCH_ATTEMPTS, now));
  });

  it("keeps api_error on the normal backoff", () => {
    expect(
      nextAttemptAtForMiss(
        MAX_MATCH_ATTEMPTS + 1,
        '{"miss_reason":"api_error"}',
        now,
      ),
    ).toEqual(nextAttemptAt(MAX_MATCH_ATTEMPTS + 1, now));
  });
});
