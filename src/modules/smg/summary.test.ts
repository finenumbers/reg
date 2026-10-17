import { describe, expect, it } from "vitest";
import { isSmgField, SMG_FIELDS } from "@/modules/smg/columns";
import { isSmgAntifraudColumn } from "@/modules/smg-trace/classify";
import {
  SMG_SUMMARY_COLUMNS,
  SMG_SUMMARY_DERIVED,
  SMG_SUMMARY_FACET_COLUMNS,
  SMG_SUMMARY_LABELS,
  formatSmgPoisonSummary,
  formatSmgSummaryCell,
  isSmgSummaryDerived,
  smgBillableMinutesCell,
} from "@/modules/smg/summary";

const base = {
  setupTime: "2026-10-13 11:59:00",
  connectTime: "2026-10-13 11:59:05",
  disconnectTime: "2026-10-13 12:00:00",
  duration: "55",
  incomingRedirectingNumber: "",
  outgoingRedirectingNumber: "",
};

describe("SMG summary columns", () => {
  it("keeps 20 working columns and does not reuse a CDR field name for a derived cell", () => {
    expect(SMG_SUMMARY_COLUMNS).toHaveLength(20);
    expect(SMG_SUMMARY_COLUMNS.slice(-2)).toEqual(["antifraud", "antifraudStatus"]);
    for (const column of SMG_SUMMARY_DERIVED) {
      expect(isSmgField(column)).toBe(false);
      expect(isSmgSummaryDerived(column)).toBe(true);
    }
    for (const column of SMG_SUMMARY_COLUMNS) {
      expect(SMG_SUMMARY_LABELS[column].length).toBeGreaterThan(0);
      if (!isSmgSummaryDerived(column) && !isSmgAntifraudColumn(column)) {
        expect(isSmgField(column)).toBe(true);
      }
    }
    expect(SMG_SUMMARY_FACET_COLUMNS).not.toContain("antifraud");
    expect(SMG_SUMMARY_FACET_COLUMNS).not.toContain("antifraudStatus");
  });

  it("facets trunk, number, and release columns, not clocks, seconds, or the redirect number", () => {
    expect(SMG_SUMMARY_FACET_COLUMNS).not.toContain("duration");
    for (const column of SMG_SUMMARY_FACET_COLUMNS) {
      expect(SMG_SUMMARY_COLUMNS).toContain(column);
      expect(isSmgField(column)).toBe(true);
      expect(isSmgSummaryDerived(column)).toBe(false);
    }
    const facets = SMG_SUMMARY_FACET_COLUMNS as readonly string[];
    expect(facets).not.toContain("setupTime");
    expect(facets).not.toContain("disconnectTime");
    expect(SMG_FIELDS).toHaveLength(52);
  });
});

describe("formatSmgSummaryCell", () => {
  it("shows the start as the date and the clock, and the answer and disconnect as clocks on that day", () => {
    expect(formatSmgSummaryCell("setupDay", base)).toBe("13.10.2026");
    expect(formatSmgSummaryCell("setupClock", base)).toBe("11:59:00");
    expect(formatSmgSummaryCell("connectClock", base)).toBe("11:59:05");
    expect(formatSmgSummaryCell("disconnectClock", base)).toBe("12:00:00");
  });

  it("draws a dash for an unanswered call and keeps a full stamp when the day differs", () => {
    const overnight = {
      ...base,
      setupTime: "2026-09-30 23:50:00",
      connectTime: "",
      disconnectTime: "2026-10-01 00:02:00",
    };
    expect(formatSmgSummaryCell("setupDay", overnight)).toBe("30.09.2026");
    expect(formatSmgSummaryCell("setupClock", overnight)).toBe("23:50:00");
    expect(formatSmgSummaryCell("connectClock", overnight)).toBe("—");
    expect(formatSmgSummaryCell("disconnectClock", overnight)).toBe(
      "01.10.2026 00:02:00",
    );
  });

  it("shows an unparsed start as raw text and does not clip the other stamps to a clock", () => {
    const raw = {
      ...base,
      setupTime: "foo",
      connectTime: "2026-10-13 12:00:05",
    };
    expect(formatSmgSummaryCell("setupDay", raw)).toBe("");
    expect(formatSmgSummaryCell("setupClock", raw)).toBe("foo");
    expect(formatSmgSummaryCell("connectClock", raw)).toBe("13.10.2026 12:00:05");
    expect(formatSmgSummaryCell("disconnectClock", raw)).toBe("13.10.2026 12:00:00");
    expect(formatSmgSummaryCell("connectClock", { ...base, connectTime: "n/a" })).toBe(
      "n/a",
    );
  });

  it("prefers the outgoing redirecting number and falls back to the incoming one", () => {
    expect(
      formatSmgSummaryCell("redirectNumber", {
        ...base,
        outgoingRedirectingNumber: "7900",
        incomingRedirectingNumber: "7800",
      }),
    ).toBe("7900");
    expect(
      formatSmgSummaryCell("redirectNumber", {
        ...base,
        outgoingRedirectingNumber: "  ",
        incomingRedirectingNumber: "7800",
      }),
    ).toBe("7800");
    expect(formatSmgSummaryCell("redirectNumber", base)).toBe("");
  });
});

describe("smgBillableMinutesCell", () => {
  it("uses the same grace as the SMG month total", () => {
    expect(smgBillableMinutesCell("")).toBe("0");
    expect(smgBillableMinutesCell("abc")).toBe("0");
    expect(smgBillableMinutesCell("3")).toBe("0");
    expect(smgBillableMinutesCell("4")).toBe("1");
    expect(smgBillableMinutesCell("60")).toBe("1");
    expect(smgBillableMinutesCell("61")).toBe("2");
    expect(smgBillableMinutesCell("0004")).toBe("1");
  });

  it("does not treat an unsafe integer as a minute count", () => {
    expect(smgBillableMinutesCell("9".repeat(18))).toBe("0");
  });
});

describe("formatSmgPoisonSummary", () => {
  it("names the file and points at the full dump", () => {
    expect(formatSmgPoisonSummary([])).toBeNull();
    expect(formatSmgPoisonSummary([{ filename: "a.cdr", error: "нет баннера" }])).toBe(
      "В папке SMG 1 файл отложен (a.cdr: нет баннера). Подробности на странице «Звонки на SMG».",
    );
    expect(
      formatSmgPoisonSummary([
        { filename: "a.cdr", error: "нет баннера" },
        { filename: "b.cdr", error: "другая" },
      ]),
    ).toMatch(/2 файлов отложены \(a\.cdr: нет баннера\)/);
  });
});
