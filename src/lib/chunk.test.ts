import { describe, expect, it } from "vitest";
import { chunkArray } from "@/lib/chunk";

describe("chunkArray", () => {
  it("splits into batches of 500-friendly size", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 500)).toEqual([]);
  });
});
