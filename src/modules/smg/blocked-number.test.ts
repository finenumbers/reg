import { describe, expect, it } from "vitest";
import { buildBlockedNumberIndex } from "@/modules/phones/blocked-numbers";
import { smgHasBlockedNumber } from "@/modules/smg/blocked-number";

describe("smgHasBlockedNumber", () => {
  const index = buildBlockedNumberIndex(["73852222205"]);

  it("hits a redirecting number and ignores an address", () => {
    expect(
      smgHasBlockedNumber(index, {
        incomingCgpn: "74950000000",
        outgoingRedirectingNumber: "3852222205",
      }),
    ).toBe(true);
    expect(
      smgHasBlockedNumber(index, {
        incomingCgpn: "74950000000",
        incomingIp: "73852222205",
      }),
    ).toBe(false);
  });
});
