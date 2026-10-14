import { describe, expect, it } from "vitest";
import { formatByteParts, formatBytes } from "@/modules/storage/format-bytes";

const NBSP = "\u202F";

describe("formatBytes", () => {
  it("treats empty sizes as zero", () => {
    expect(formatBytes(0)).toBe("0 Б");
    expect(formatBytes(-1)).toBe("0 Б");
    expect(formatBytes(Number.NaN)).toBe("0 Б");
    expect(formatByteParts(0)).toEqual({ value: "0", unit: "Б" });
  });

  it("keeps one decimal under 10 KB", () => {
    expect(formatBytes(1.5 * 1024)).toBe("1.5 КБ");
  });

  it("keeps the 1024 step and groups a large terabyte figure", () => {
    expect(formatBytes(12 * 1024 * 1024)).toBe("12 МБ");
    expect(formatBytes(1919 * 1024 * 1024)).toBe("1.9 ГБ");
    const tebibytes = 1919 * 1024 ** 4;
    expect(formatBytes(tebibytes)).toBe(`1${NBSP}919 ТБ`);
    expect(formatByteParts(tebibytes)).toEqual({
      value: `1${NBSP}919`,
      unit: "ТБ",
    });
  });

  it("groups the already rounded toFixed result", () => {
    expect(formatBytes(9.96 * 1024)).toBe("10.0 КБ");
  });
});
