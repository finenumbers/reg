import { describe, expect, it } from "vitest";
import { QUEUE_EXHAUSTED_AT } from "@/modules/voipmonitor/constants";
import { voipmonitorParkedLinkWhere } from "@/modules/voipmonitor/count";

describe("voipmonitorParkedLinkWhere", () => {
  it("selects empty URLs parked on the exhausted sentinel", () => {
    expect(voipmonitorParkedLinkWhere()).toEqual({
      voipmonitorUrl: "",
      nextAttemptAt: { gte: QUEUE_EXHAUSTED_AT },
    });
  });
});
