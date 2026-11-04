import { describe, expect, it } from "vitest";
import { orderLiveCallsByStart } from "@/modules/live-calls/order";

function row(startedAt: string, mark: string) {
  return { startedAt, mark };
}

describe("orderLiveCallsByStart", () => {
  it("puts the earlier start time first and keeps equals and unparsed rows in join order", () => {
    const ordered = orderLiveCallsByStart([
      row("2026-11-04 09:00:00", "older"),
      row("2026-11-04 10:00:00", "newer"),
      row("2026-11-04 10:00:00", "same"),
      row("1", "junk"),
      row("", "blank"),
      row("  ", "spaces"),
      row("2026-02-31 00:00:00", "impossible"),
      row("2026-03-01 00:00:00", "march"),
      row("9", "digit"),
    ]);
    expect(ordered.map((item) => item.mark)).toEqual([
      "impossible",
      "march",
      "older",
      "newer",
      "same",
      "junk",
      "blank",
      "spaces",
      "digit",
    ]);
  });
});