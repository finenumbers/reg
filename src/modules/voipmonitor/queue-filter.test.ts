import { describe, expect, it } from "vitest";
import { MAX_MATCH_ATTEMPTS } from "@/modules/voipmonitor/constants";
import { isTerminalNotFoundExhausted } from "@/modules/voipmonitor/queue-filter";

describe("isTerminalNotFoundExhausted", () => {
  it("keeps assigned_elsewhere in the queue after the attempt cap", () => {
    expect(
      isTerminalNotFoundExhausted(
        MAX_MATCH_ATTEMPTS,
        '{"miss_reason":"assigned_elsewhere","stage":"exact_call_id"}',
      ),
    ).toBe(false);
  });

  it("keeps api_error in the queue after the attempt cap", () => {
    expect(
      isTerminalNotFoundExhausted(
        MAX_MATCH_ATTEMPTS + 1,
        '{"miss_reason":"api_error"}',
      ),
    ).toBe(false);
  });

  it("stops call_id_not_in_index at the attempt cap", () => {
    expect(
      isTerminalNotFoundExhausted(
        MAX_MATCH_ATTEMPTS - 1,
        '{"miss_reason":"call_id_not_in_index"}',
      ),
    ).toBe(false);
    expect(
      isTerminalNotFoundExhausted(
        MAX_MATCH_ATTEMPTS,
        '{"miss_reason":"call_id_not_in_index","stage":"fallback"}',
      ),
    ).toBe(true);
  });
});
