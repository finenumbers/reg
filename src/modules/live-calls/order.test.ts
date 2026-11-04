import { describe, expect, it } from "vitest";
import { orderLiveCallsByStart } from "@/modules/live-calls/order";

function row(startedAt: string, mark: string) {
  return { startedAt, mark };
}

describe("orderLiveCallsByStart", () => {
  it("puts the newer start time first and keeps equals and unparsed rows in join order", () => {
    const ordered = orderLiveCallsByStart([
      row("2026-11-04 09:00:00", "older"),
      row("2026-11-04 10:00:00", "newer"),
      row("2026-11-04 10:00:00", "same"),
      row("04.11.2026 04:30:45", "dottedEarlier"),
      row("04.11.2026 04:31:04", "dottedLater"),
      row("04.11.2026, 04:31:04", "commaSame"),
      row("  04.11.2026 04:30:45  ", "paddedEarlier"),
      row("1", "junk"),
      row("", "blank"),
      row("  ", "spaces"),
      row("2026-02-31 00:00:00", "impossible"),
      row("2026-03-01 00:00:00", "march"),
      row("04.11.2026 99:99:99", "badClock"),
      row("2026-11-04 99:00:00", "badIso"),
      row("9", "digit"),
    ]);
    expect(ordered.map((item) => item.mark)).toEqual([
      "newer",
      "same",
      "older",
      "dottedLater",
      "commaSame",
      "dottedEarlier",
      "paddedEarlier",
      "march",
      "impossible",
      "junk",
      "blank",
      "spaces",
      "badClock",
      "badIso",
      "digit",
    ]);
  });
});