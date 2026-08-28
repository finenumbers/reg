import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import {
  MISSING_BILLING_LABEL,
  MISSING_PSTN_LABEL,
} from "@/modules/enrich/types";
import {
  composeTrafficBanner,
  displayTrafficFacet,
  formatCdrDateDisplay,
  formatDurationSeconds,
  formatTrafficCell,
  trafficMissingLabelClass,
} from "@/modules/traffic/ui-format";

describe("traffic UI date display", () => {
  it("reformats CDR civil time without shifting the clock", () => {
    expect(formatCdrDateDisplay("2026-12-28 01:23:43")).toBe(
      "28.12.2026, 01:23:43",
    );
    expect(formatCdrDateDisplay("2026-12-01 23:48:22")).toBe(
      "01.12.2026, 23:48:22",
    );
    expect(formatCdrDateDisplay("")).toBe("");
    expect(formatCdrDateDisplay("not-a-date")).toBe("not-a-date");
  });

  it("formats only cdr_date cells", () => {
    expect(formatTrafficCell("cdr_date", "2026-12-28 01:23:43")).toBe(
      "28.12.2026, 01:23:43",
    );
    expect(formatTrafficCell("bill_ani", "79001234567")).toBe("79001234567");
  });

  it("rounds duration columns to whole seconds", () => {
    expect(formatDurationSeconds("22.4")).toBe("23");
    expect(formatDurationSeconds("22,6")).toBe("23");
    expect(formatDurationSeconds("22")).toBe("22");
    expect(formatDurationSeconds("0")).toBe("0");
    expect(formatDurationSeconds("")).toBe("");
    expect(formatDurationSeconds("n/a")).toBe("n/a");
    expect(formatTrafficCell("elapsed_time", "12.2")).toBe("13");
    expect(formatTrafficCell("term_elapsed_time", "1.5")).toBe("2");
    expect(displayTrafficFacet("elapsed_time", "9.9")).toBe("10");
  });

  it("shows empty facet token as (пусто) and formats cdr_date facets", () => {
    expect(displayTrafficFacet("cdr_date", EMPTY_FILTER_TOKEN)).toBe(
      "(пусто)",
    );
    expect(displayTrafficFacet("cdr_date", "")).toBe("(пусто)");
    expect(displayTrafficFacet("cdr_date", "2026-12-28 01:23:43")).toBe(
      "28.12.2026, 01:23:43",
    );
    expect(displayTrafficFacet("bill_ani", "79001234567")).toBe("79001234567");
  });

  it("colors billing and PSTN miss labels", () => {
    expect(trafficMissingLabelClass(MISSING_BILLING_LABEL)).toBe(
      "text-yellow-600",
    );
    expect(trafficMissingLabelClass(MISSING_PSTN_LABEL)).toBe("text-red-600");
    expect(trafficMissingLabelClass("МТС")).toBeUndefined();
  });

  it("composes inbox and partial-import banners", () => {
    expect(
      composeTrafficBanner({
        lastError: null,
        pendingInboxCount: 0,
        poisonedCount: 0,
        runningCount: 0,
      }),
    ).toBeNull();
    expect(
      composeTrafficBanner({
        lastError: "Частичная загрузка: вставлено 10 записей",
        pendingInboxCount: 0,
        poisonedCount: 1,
        runningCount: 0,
      }),
    ).toContain("Частичная загрузка");
    expect(
      composeTrafficBanner({
        lastError: null,
        pendingInboxCount: 2,
        poisonedCount: 0,
        runningCount: 1,
      }),
    ).toMatch(/2 необработанных файлов.*выполняется/);
    expect(
      composeTrafficBanner({
        lastError: null,
        pendingInboxCount: 0,
        poisonedCount: 1,
        runningCount: 0,
      }),
    ).toMatch(/Сырые данные/);
  });
});
