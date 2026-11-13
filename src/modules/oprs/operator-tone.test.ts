import { describe, expect, it } from "vitest";
import { NUMBERING_OR_MAX } from "@/modules/numbering-resource/filters";
import { OPRS_COLUMNS } from "@/modules/traffic/columns";
import { CALL_STATUS } from "@/modules/traffic/call-class";
import {
  OPRS_OPERATOR_INNS,
  oprsFailedTail,
  oprsNamesByTone,
  oprsOperatorTone,
  oprsStampedTone,
  oprsToneMap,
  oprsToneReport,
  oprsUnpaintedLabelEnabled,
  type OprsOperatorTone,
} from "@/modules/oprs/operator-tone";

const INN_WEIGHTS = [2, 4, 10, 3, 5, 9, 4, 6, 8];

function innChecksumOk(inn: string): boolean {
  if (!/^\d{10}$/.test(inn)) return false;
  const sum = INN_WEIGHTS.reduce(
    (total, weight, index) => total + weight * Number(inn[index]),
    0,
  );
  return (sum % 11) % 10 === Number(inn[9]);
}

describe("oprs unpainted label", () => {
  it("stays off for an empty or truncated map", () => {
    expect(oprsUnpaintedLabelEnabled({ map: {}, truncated: [] })).toBe(false);
    expect(oprsUnpaintedLabelEnabled({ map: { МТС: "red" }, truncated: ["gray"] })).toBe(
      false,
    );
    expect(oprsUnpaintedLabelEnabled({ map: { МТС: "red" }, truncated: [] })).toBe(true);
  });
});

describe("oprs operator inns", () => {
  it("keeps the previous inns and adds the new ones under the color cap", () => {
    expect(OPRS_OPERATOR_INNS.green).toEqual(["7812014560", "7701725181", "7740000020"]);
    expect(OPRS_OPERATOR_INNS.red).toEqual(["7740000076", "7705017253"]);
    expect(OPRS_OPERATOR_INNS.yellow).toEqual(["7713076301", "9725152215"]);
    expect(OPRS_OPERATOR_INNS.gray).toEqual([
      "7743895280",
      "7707049388",
      "9705121882",
      "7727443720",
      "9722028932",
      "6163225548",
      "7451318173",
      "7727842771",
      "7709362765",
      "7727752084",
      "6670019135",
      "7721634013",
      "3808084952",
      "9710027740",
    ]);
    const all = Object.values(OPRS_OPERATOR_INNS).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const inns of Object.values(OPRS_OPERATOR_INNS)) {
      expect(inns.length).toBeLessThanOrEqual(NUMBERING_OR_MAX);
      for (const inn of inns) expect(innChecksumOk(inn)).toBe(true);
    }
  });
});

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
    expect(oprsNamesByTone({ "ПАО МТС": "red", Мега: "green" })).toEqual({
      green: ["Мега"],
      red: ["ПАО МТС"],
      yellow: [],
      gray: [],
    });
  });

  it("keeps two names of one color and reports a shared name", () => {
    const groups = [
      { tone: "gray" as const, names: ["Т2", "Ростелеком"], truncated: false },
      { tone: "gray" as const, names: ["Ростелеком"], truncated: false },
      { tone: "red" as const, names: ["Ростелеком"], truncated: false },
      { tone: "yellow" as const, names: ["Билайн"], truncated: true },
    ];
    const report = oprsToneReport(groups);
    expect(report.map).toEqual({ Т2: "gray" });
    expect(report.truncated).toEqual(["yellow"]);
    expect(report.conflicts).toEqual([{ name: "Ростелеком", tones: ["gray", "red"] }]);
    expect(oprsStampedTone("gray")).toBe("gray");
    expect(oprsStampedTone("")).toBeNull();
    expect(oprsStampedTone("blue")).toBeNull();
    const tones: OprsOperatorTone[] = ["green", "red", "yellow", "gray"];
    expect(tones).toHaveLength(4);
  });
});

describe("oprs failed tail", () => {
  it("starts at seconds and stays off for any other status", () => {
    expect(oprsFailedTail("elapsed_time", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(true);
    expect(oprsFailedTail("src_name", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(true);
    expect(oprsFailedTail("voipmonitor_url_out", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(
      true,
    );
    expect(oprsFailedTail("oprs_mav", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(false);
    expect(oprsFailedTail("oprs_marking", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(false);
    expect(oprsFailedTail("oprs_network", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(false);
    expect(oprsFailedTail("operator_b", OPRS_COLUMNS, CALL_STATUS.failed)).toBe(false);
    expect(oprsFailedTail("elapsed_time", OPRS_COLUMNS, CALL_STATUS.success)).toBe(false);
    expect(oprsFailedTail("elapsed_time", ["cdr_day"], CALL_STATUS.failed)).toBe(false);
  });
});
