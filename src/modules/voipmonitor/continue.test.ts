import { describe, expect, it } from "vitest";
import { shouldChainVoipmonitorMatch } from "@/modules/voipmonitor/continue";

describe("shouldChainVoipmonitorMatch", () => {
  it("chains after a real hour", () => {
    expect(
      shouldChainVoipmonitorMatch({
        status: "success",
        hoursProcessed: 1,
      }),
    ).toBe(true);
    expect(
      shouldChainVoipmonitorMatch({
        status: "success",
        hoursProcessed: 2,
      }),
    ).toBe(true);
  });

  it("does not chain skip, empty pick, or total miss", () => {
    expect(
      shouldChainVoipmonitorMatch({
        status: "success",
        skipped: true,
        hoursProcessed: 0,
      }),
    ).toBe(false);
    expect(
      shouldChainVoipmonitorMatch({
        status: "success",
        hoursProcessed: 0,
      }),
    ).toBe(false);
    expect(
      shouldChainVoipmonitorMatch({
        status: "failed",
        hoursProcessed: 0,
      }),
    ).toBe(false);
    expect(
      shouldChainVoipmonitorMatch({
        status: "failed",
        hoursProcessed: 1,
      }),
    ).toBe(false);
    expect(shouldChainVoipmonitorMatch(null)).toBe(false);
  });
});
