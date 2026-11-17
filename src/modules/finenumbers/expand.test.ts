import { describe, expect, it } from "vitest";

import {
  admitRange,
  catalogOf,
  e164Of,
  expandSlice,
  FINENUMBERS_INN,
  sliceBounds,
} from "@/modules/finenumbers/expand";
import { pstnCacheKey } from "@/modules/rtu/sql";

const range = {
  abc: "495",
  rangeStart: 1_000_000,
  rangeEnd: 1_000_099,
  capacity: 100,
  inn: FINENUMBERS_INN,
  operator: "Finenumbers",
  geography: "Москва",
};

describe("Finenumbers range expansion", () => {
  it("expands an inclusive hundred and pads the local part", () => {
    expect(admitRange(range)).toBeNull();
    const rows = expandSlice(range, range.rangeStart, range.rangeEnd);
    expect(rows).toHaveLength(100);
    expect(rows[0]?.e164).toBe("74951000000");
    expect(rows[99]?.e164).toBe("74951000099");
    expect(e164Of("495", 42)).toBe("74950000042");
    expect(new Set(rows.map((row) => row.e164)).size).toBe(100);
  });

  it("rejects a capacity that is not the inclusive count", () => {
    expect(admitRange({ ...range, capacity: 99 })).not.toBeNull();
    expect(admitRange({ ...range, capacity: 101 })).not.toBeNull();
  });

  it("keeps a gap and does not repeat the boundary of a 501-number range", () => {
    const left = expandSlice(range, range.rangeStart, range.rangeEnd);
    const right = expandSlice(
      { ...range, rangeStart: 1_000_100, rangeEnd: 1_000_199, capacity: 100 },
      1_000_100,
      1_000_199,
    );
    const joined = new Set([...left, ...right].map((row) => row.e164));
    expect(joined.size).toBe(200);
    expect(joined.has("74951000099")).toBe(true);
    expect(joined.has("74951000100")).toBe(true);
    const gapped = expandSlice(
      { ...range, rangeStart: 1_000_200, rangeEnd: 1_000_299, capacity: 100 },
      1_000_200,
      1_000_299,
    );
    const withGap = new Set([...left, ...gapped].map((row) => row.e164));
    expect(withGap.size).toBe(200);
    expect(withGap.has("74951000100")).toBe(false);

    const wide = { ...range, rangeStart: 0, rangeEnd: 500, capacity: 501 };
    const slices = sliceBounds(wide.rangeStart, wide.rangeEnd, 500);
    expect(slices).toEqual([
      { from: 0, to: 499 },
      { from: 500, to: 500 },
    ]);
    const expanded = slices.flatMap((slice) => expandSlice(wide, slice.from, slice.to));
    expect(expanded).toHaveLength(501);
    expect(expanded[499]?.e164).toBe(e164Of("495", 499));
    expect(expanded[500]?.e164).toBe(e164Of("495", 500));
    expect(new Set(expanded.map((row) => row.e164)).size).toBe(501);
  });

  it("buys a number that is on the phone snapshot in any admitted shape", () => {
    const keys = new Set(
      ["84951000000", "74951000001", "4951000002"]
        .map((value) => pstnCacheKey(value))
        .filter((value): value is string => value != null),
    );
    expect(catalogOf("74951000000", keys)).toBe("purchased");
    expect(catalogOf("74951000001", keys)).toBe("purchased");
    expect(catalogOf("74951000002", keys)).toBe("purchased");
    expect(catalogOf("74951000003", keys)).toBe("free");
  });

  it("rejects a foreign INN and a short ABC", () => {
    expect(admitRange({ ...range, inn: "7700000000" })).toMatch(/чужой ИНН/);
    expect(admitRange({ ...range, inn: " 5406978329 " })).toBeNull();
    expect(admitRange({ ...range, abc: "49" })).not.toBeNull();
  });
});
