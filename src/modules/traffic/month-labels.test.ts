import { describe, expect, it } from "vitest";
import {
  formatMonthGenitive,
  formatMonthNominative,
  formatMonthOption,
  monthExportJobTitle,
  monthExportSheetName,
} from "@/modules/traffic/month-labels";

describe("month labels", () => {
  it("declines July and August", () => {
    expect(formatMonthGenitive(2026, 7)).toBe("июля 2026 года");
    expect(formatMonthNominative(2026, 7)).toBe("Июль 2026 года");
    expect(formatMonthGenitive(2026, 8)).toBe("августа 2026 года");
    expect(formatMonthNominative(2026, 8)).toBe("Август 2026 года");
    expect(formatMonthOption(2026, 8)).toBe("Август 2026 года");
    expect(formatMonthOption(2026, 8, 12)).toBe("Август 2026 года (12)");
  });

  it("names the export sheet after the selected month", () => {
    expect(monthExportSheetName(2026, 7)).toBe("Июль 2026 года");
    expect(monthExportSheetName(2026, 8)).toBe("Август 2026 года");
    expect(monthExportJobTitle(2026, 8)).toBe(
      "Сохранить данные августа 2026 года",
    );
    expect(monthExportJobTitle(2026, 8, true)).toBe(
      "Сохранить расширенные данные августа 2026 года",
    );
    expect(monthExportSheetName(2026, 9).length).toBeLessThanOrEqual(31);
  });
});
