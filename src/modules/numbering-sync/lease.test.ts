import { describe, expect, it } from "vitest";
import {
  CatalogReplaced,
  guardCatalogGeneration,
  noteCatalogReplaced,
} from "@/modules/numbering-sync/lease";

describe("catalog generation", () => {
  it("rejects an export that started before the catalogs were replaced", () => {
    const seen = guardCatalogGeneration();
    noteCatalogReplaced();
    expect(() => guardCatalogGeneration(seen)).toThrow(CatalogReplaced);
    expect(guardCatalogGeneration()).toBe(seen + 1);
  });
});
