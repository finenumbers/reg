import { describe, expect, it } from "vitest";
import {
  formatMonthGenitive,
  formatMonthNominative,
  monthExportButtonLabel,
  monthExportSheetName,
} from "@/modules/traffic/month-labels";

describe("month labels", () => {
  it("declines July and August", () => {
    expect(formatMonthGenitive(2026, 7)).toBe("июля 2026 года");
    expect(formatMonthNominative(2026, 7)).toBe("Июль 2026 года");
    expect(formatMonthGenitive(2026, 8)).toBe("августа 2026 года");
    expect(formatMonthNominative(2026, 8)).toBe("Август 2026 года");
  });

  it("builds button and sheet phrases", () => {
    expect(monthExportButtonLabel("previous", 2026, 7)).toBe(
      "Сохранить данные июля 2026 года",
    );
    expect(monthExportButtonLabel("current", 2026, 8)).toBe(
      "Неполные данные августа 2026 года",
    );
    expect(monthExportSheetName("previous", 2026, 7)).toBe("Июль 2026 года");
    expect(monthExportSheetName("current", 2026, 8)).toBe(
      "Август 2026 года (неполный)",
    );
    expect(monthExportSheetName("current", 2026, 9).length).toBeLessThanOrEqual(
      31,
    );
  });
});
