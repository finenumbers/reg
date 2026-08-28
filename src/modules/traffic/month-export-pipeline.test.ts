import { describe, expect, it } from "vitest";
import { windowWhere } from "@/modules/traffic/month-export-pipeline";

describe("windowWhere", () => {
  const importedAt = new Date("2026-08-29T03:00:00.000Z");

  it("selects June by cdr_date prefix, not shifted cdrAt", () => {
    expect(windowWhere(2026, 6, importedAt)).toEqual({
      cdrDate: { startsWith: "2026-06-" },
      importedAt: { lte: importedAt },
    });
  });
});
