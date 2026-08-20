import { describe, expect, it } from "vitest";
import { formatDisplayTimestamp, formatExportTimestamp } from "@/lib/format-display-time";
import { resolveDisplayTimezone } from "@/lib/display-timezone";

describe("formatDisplayTimestamp", () => {
  it("formats Moscow as dd.MM.yyyy, HH:mm:ss", () => {
    expect(
      formatDisplayTimestamp("2026-08-20T15:50:05.000Z", "Europe/Moscow"),
    ).toBe("20.08.2026, 18:50:05");
  });

  it("formats Krasnoyarsk (UTC+7) from the same instant", () => {
    expect(
      formatDisplayTimestamp("2026-08-20T15:50:05.000Z", "Asia/Krasnoyarsk"),
    ).toBe("20.08.2026, 22:50:05");
  });

  it("handles empty and invalid values", () => {
    expect(formatDisplayTimestamp(null, "Europe/Moscow")).toBe("—");
    expect(formatDisplayTimestamp("not-a-date", "UTC")).toBe("—");
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
    expect(resolveDisplayTimezone("Asia/Krasnoyarsk")).toBe("Asia/Krasnoyarsk");
  });
});
