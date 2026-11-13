import { describe, expect, it } from "vitest";
import { OPRS_COLUMNS } from "@/modules/traffic/columns";
import { CALL_STATUS } from "@/modules/traffic/call-class";
import {
  oprsFailedTail,
  oprsOperatorTone,
  oprsToneMap,
} from "@/modules/oprs/operator-tone";

describe("oprs operator tone map", () => {
  it("paints a trimmed name and drops a truncated inn and a shared name", () => {
    const map = oprsToneMap([
      { tone: "green", names: ["  МегаФон  ", ""], truncated: false },
      { tone: "red", names: ["МТС", "МегаФон"], truncated: false },
      { tone: "yellow", names: ["Билайн", "ещё"], truncated: true },
      { tone: "gray", names: ["Т2"], truncated: false },
    ]);
    expect(map).toEqual({ МТС: "red", Т2: "gray" });
    expect(oprsOperatorTone("  Т2 ", map)).toBe("gray");
    expect(oprsOperatorTone("МегаФон", map)).toBeNull();
    expect(oprsOperatorTone("Билайн", map)).toBeNull();
    expect(oprsOperatorTone("   ", map)).toBeNull();
  });
});

describe("oprs failed tail", () => {
  it("starts at marking and stays off for any other status", () => {
    expect(oprsFailedTail("oprs_marking", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(true);
    expect(oprsFailedTail("oprs_mav", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(true);
    expect(oprsFailedTail("voipmonitor_url_out", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(true);
    expect(oprsFailedTail("geography_b", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(false);
    expect(oprsFailedTail("operator_b", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(false);
    expect(oprsFailedTail("oprs_marking", OPRS_COLUMNS, CALL_STATUS.success)).toBe(false);
    expect(oprsFailedTail("oprs_marking", ["cdr_day"], CALL_STATUS.failed)).toBe(false);
  });
});
