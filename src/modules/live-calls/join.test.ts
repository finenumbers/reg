import { describe, expect, it } from "vitest";
import { joinLiveCalls, type CallSide, type CallTalk } from "@/modules/live-calls/join";
import {
  liveCallSeconds,
  presentSwitchValue,
  presentTalkSeconds,
} from "@/modules/live-calls/format";

function side(
  conferenceId: string,
  values: CallSide["values"] = {},
  talk: CallTalk | null = null,
): CallSide {
  return { conferenceId, values, talk };
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
    expect(rows[0]).toMatchObject({
      state: "talk",
      startedAt: "10:00",
      outA: "100",
      sourceName: "gw-a",
    });
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

describe("liveCallSeconds", () => {
  const takenAt = Date.parse("2026-11-03T23:32:45.000Z");

  it("counts whole seconds from the connection stamp to the snapshot", () => {
    expect(liveCallSeconds("2026-11-03 23:32:00", takenAt)).toBe("45");
    expect(liveCallSeconds("", takenAt)).toBe("");
    expect(liveCallSeconds("not-a-time", takenAt)).toBe("");
    expect(liveCallSeconds("2026-11-03 23:33:00", takenAt)).toBe("0");
  });

  it("reads 14-digit YMDhms and drops a fractional second", () => {
    const later = Date.UTC(2023, 10, 14, 22, 13, 20);
    expect(liveCallSeconds("20231114221235", later)).toBe("45");
    expect(liveCallSeconds("2023-11-14 22:12:35.900", later)).toBe("45");
    expect(liveCallSeconds("2023-11-14 22:12:35", later)).toBe("45");
  });
});

describe("presentTalkSeconds", () => {
  it("keeps whole seconds, a zero, and a clock", () => {
    expect(presentTalkSeconds("37")).toBe("37");
    expect(presentTalkSeconds("0")).toBe("0");
    expect(presentTalkSeconds("007")).toBe("7");
    expect(presentTalkSeconds("00:01:05")).toBe("65");
    expect(presentTalkSeconds("12,4")).toBe("12");
    expect(presentTalkSeconds("12.9")).toBe("12");
    expect(presentTalkSeconds("")).toBe("");
    expect(presentTalkSeconds("00:99:00")).toBe("00:99:00");
  });
});

describe("switch duration", () => {
  it("prefers the seconds column and does not invent a value for a blank cell", () => {
    const preferred = joinLiveCalls(
      [side("c1", {}, { text: "10", explicitSeconds: false })],
      [side("c1", {}, { text: "37", explicitSeconds: true })],
    );
    expect(preferred[0]?.switchSeconds).toBe("37");

    const zero = joinLiveCalls(
      [side("c1", {}, { text: "0", explicitSeconds: true })],
      [side("c1", {}, { text: "8", explicitSeconds: false })],
    );
    expect(zero[0]?.switchSeconds).toBe("0");

    const blank = joinLiveCalls(
      [side("c1", {}, { text: "", explicitSeconds: true })],
      [],
    );
    expect(blank[0]?.switchSeconds).toBe("");

    const absent = joinLiveCalls([side("c1")], [side("c1")]);
    expect(absent[0]?.switchSeconds).toBeNull();
  });
});
