import { describe, expect, it } from "vitest";
import { AF_CATEGORY, AF_STATUS } from "@/modules/smg-trace/classify";
import { formatSmgSummaryCell } from "@/modules/smg/summary";
import {
  maskDisabledAntifraud,
  NO_ANTIFRAUD_LABEL,
  NO_TRACE_LABELS,
  redirectToken,
  resolveStoredTraces,
  setupDayToken,
} from "@/modules/smg/row-tokens";

const stamps = {
  setupTime: "2026-10-13 11:59:00",
  connectTime: "",
  disconnectTime: "",
  duration: "0",
  incomingRedirectingNumber: "",
  outgoingRedirectingNumber: "",
};

describe("setupDayToken", () => {
  it("uses the same day the date cell shows", () => {
    expect(setupDayToken("2026-10-13 11:59:00")).toBe("2026-10-13");
    expect(formatSmgSummaryCell("setupDay", stamps)).toBe("13.10.2026");
    expect(setupDayToken("2026-10-13T11:59:00")).toBe("2026-10-13");
    expect(setupDayToken("  2026-09-30 23:50:00")).toBe("2026-09-30");
  });

  it("treats a bare date and garbage as an empty cell", () => {
    expect(setupDayToken("2026-10-13")).toBe("");
    expect(setupDayToken("foo")).toBe("");
    expect(setupDayToken("")).toBe("");
  });
});

describe("redirectToken", () => {
  it("prefers a trimmed outgoing number and does not split a row", () => {
    expect(redirectToken("  7900 ", "7800")).toBe("7900");
    expect(redirectToken("   ", "7800")).toBe("7800");
    expect(redirectToken("", "")).toBe("");
  });
});

describe("resolveStoredTraces", () => {
  it("is empty without a card and conflict when two cards share the keys", () => {
    expect(resolveStoredTraces([])).toEqual({ kind: "none" });
    expect(NO_TRACE_LABELS).toEqual({
      category: AF_CATEGORY.noData,
      status: AF_STATUS.unknown,
    });
    expect(
      resolveStoredTraces([
        { id: "a", category: AF_CATEGORY.passed, status: AF_STATUS.firstTry },
        { id: "b", category: AF_CATEGORY.blocked, status: AF_STATUS.retry },
      ]),
    ).toEqual({
      kind: "ready",
      category: AF_CATEGORY.conflict,
      status: AF_STATUS.unknown,
    });
  });

  it("counts one card once and waits when its label is not stored", () => {
    const stored = { id: "a", category: AF_CATEGORY.passed, status: AF_STATUS.firstTry };
    expect(resolveStoredTraces([stored, stored])).toEqual({
      kind: "ready",
      category: AF_CATEGORY.passed,
      status: AF_STATUS.firstTry,
    });
    expect(resolveStoredTraces([{ id: "a", category: null, status: null }])).toEqual({
      kind: "pending",
      traceId: "a",
    });
  });
});

describe("maskDisabledAntifraud", () => {
  it("keeps a row filter that does not name antifraud", () => {
    const filters = { setupDay: ["2026-10-13"] };
    expect(maskDisabledAntifraud(filters)).toEqual({ empty: false, filters });
  });

  it("treats the label as a match inside one column and AND across columns", () => {
    expect(
      maskDisabledAntifraud({
        antifraud: [NO_ANTIFRAUD_LABEL, AF_CATEGORY.passed],
        setupDay: ["2026-10-13"],
      }),
    ).toEqual({ empty: false, filters: { setupDay: ["2026-10-13"] } });
    expect(
      maskDisabledAntifraud({
        antifraud: [NO_ANTIFRAUD_LABEL],
        antifraudStatus: [AF_STATUS.firstTry],
      }).empty,
    ).toBe(true);
    expect(maskDisabledAntifraud({ antifraud: [AF_CATEGORY.passed] }).empty).toBe(true);
  });
});
