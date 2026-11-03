import { describe, expect, it } from "vitest";
import { joinLiveCalls, type CallSide } from "@/modules/live-calls/join";
import { presentSwitchValue } from "@/modules/live-calls/format";

function side(conferenceId: string, values: CallSide["values"] = {}): CallSide {
  return { conferenceId, values };
}

describe("joinLiveCalls", () => {
  it("pairs on conference id and keeps leftovers", () => {
    const rows = joinLiveCalls(
      [
        side("c1", { startedAt: "10:00", outA: "100" }),
        side("  ", { startedAt: "alone" }),
      ],
      [
        side("c1", { state: "talk", sourceName: "gw-a" }),
        side("c1", { state: "extra", sourceName: "gw-b" }),
        side("", { state: "blank" }),
      ],
    );
    expect(rows.map((row) => row.conferenceId)).toEqual(["c1", "", "c1", ""]);
    expect(rows[0]).toMatchObject({ state: "talk", startedAt: "10:00", outA: "100", sourceName: "gw-a" });
    expect(rows[1]).toMatchObject({ startedAt: "alone", state: "" });
    expect(rows[2]).toMatchObject({ state: "extra", startedAt: "", sourceName: "gw-b" });
    expect(rows[3]).toMatchObject({ state: "blank", startedAt: "" });
  });

  it("does not merge unrelated rows that have no conference id", () => {
    const rows = joinLiveCalls(
      [side(""), side("")],
      [side(""), side("c2", { state: "up" })],
    );
    expect(rows).toHaveLength(4);
    expect(rows[2]).toMatchObject({ conferenceId: "c2", state: "up" });
    expect(rows[3]).toMatchObject({ conferenceId: "", state: "" });
  });
});

describe("presentSwitchValue", () => {
  it("formats YMDhms without moving the clock", () => {
    expect(presentSwitchValue("20261103233200", "YMDhms")).toBe("2026-11-03 23:32:00");
    expect(presentSwitchValue("5", "YMDhms")).toBe("5");
    expect(presentSwitchValue("20261103233200", null)).toBe("20261103233200");
  });
});
