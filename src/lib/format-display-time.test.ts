import { describe, expect, it } from "vitest";
import {
  formatDisplayClock,
  formatDisplayTimestamp,
  formatDisplayUtcDate,
  formatExportTimestamp,
} from "@/lib/format-display-time";
import { resolveDisplayTimezone } from "@/lib/display-timezone";

describe("formatDisplayTimestamp", () => {
  it("formats Moscow as dd.MM.yyyy, HH:mm:ss", () => {
    expect(
      formatDisplayTimestamp("2026-08-20T15:50:05.000Z", "Europe/Moscow"),
    ).toBe("20.08.2026, 18:50:05");
  });

  it("formats Novosibirsk (UTC+7) from the same instant", () => {
    expect(
      formatDisplayTimestamp("2026-08-20T15:50:05.000Z", "Asia/Novosibirsk"),
    ).toBe("20.08.2026, 22:50:05");
  });

  it("handles empty and invalid values", () => {
    expect(formatDisplayTimestamp(null, "Europe/Moscow")).toBe("—");
    expect(formatDisplayTimestamp("not-a-date", "UTC")).toBe("—");
  });
});

describe("formatDisplayClock", () => {
  const instant = new Date("2026-08-20T15:50:05.000Z");

  it("formats UTC and Moscow from the same instant", () => {
    expect(formatDisplayClock(instant, "UTC")).toBe("15:50:05");
    expect(formatDisplayClock(instant, "Europe/Moscow")).toBe("18:50:05");
  });

  it("crosses midnight in Moscow", () => {
    expect(
      formatDisplayClock(new Date("2026-08-20T21:00:00.000Z"), "Europe/Moscow"),
    ).toBe("00:00:00");
  });
});

describe("formatDisplayUtcDate", () => {
  it("formats the UTC calendar day without a year", () => {
    expect(formatDisplayUtcDate(new Date("2026-09-17T11:14:13.000Z"))).toBe(
      "17 сентября",
    );
  });

  it("stays on the UTC day past display-timezone midnight", () => {
    expect(formatDisplayUtcDate(new Date("2026-09-17T23:00:00.000Z"))).toBe(
      "17 сентября",
    );
  });

  it("drops the leading zero on the first of the month", () => {
    expect(formatDisplayUtcDate(new Date("2026-01-01T00:00:00.000Z"))).toBe(
      "1 января",
    );
  });

  it("keeps a UTC leap day", () => {
    expect(formatDisplayUtcDate(new Date("2024-02-29T00:00:00.000Z"))).toBe(
      "29 февраля",
    );
  });
});

describe("formatExportTimestamp", () => {
  it("uses display timezone for the filename stamp", () => {
    expect(
      formatExportTimestamp(new Date("2026-08-20T15:50:05.000Z"), "Europe/Moscow"),
    ).toBe("20260820-1850");
  });
});

describe("resolveDisplayTimezone", () => {
  it("falls back to Moscow for unknown zones", () => {
    expect(resolveDisplayTimezone("Mars/Phobos")).toBe("Europe/Moscow");
    expect(resolveDisplayTimezone("Asia/Novosibirsk")).toBe("Asia/Novosibirsk");
    expect(resolveDisplayTimezone("Asia/Krasnoyarsk")).toBe("Asia/Novosibirsk");
  });
});
