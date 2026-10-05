import { describe, expect, it } from "vitest";
import { formatCount } from "@/lib/format-count";
import { formatDatabaseGigabytes } from "@/lib/format-db-gigabytes";

const GIB = 1024 ** 3;

describe("formatDatabaseGigabytes", () => {
  it("always shows one decimal gigabyte", () => {
    expect(formatDatabaseGigabytes(0)).toBe("0,0 Gb");
    expect(formatDatabaseGigabytes(-1)).toBe("0,0 Gb");
    expect(formatDatabaseGigabytes(Number.NaN)).toBe("0,0 Gb");
    expect(formatDatabaseGigabytes(50 * 1024 ** 2)).toBe("0,0 Gb");
    expect(formatDatabaseGigabytes(GIB)).toBe("1,0 Gb");
    expect(formatDatabaseGigabytes(1000 * GIB)).toBe(`${formatCount(1000)},0 Gb`);
    expect(formatDatabaseGigabytes(1.05 * GIB)).toBe("1,1 Gb");
  });
});
