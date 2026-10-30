import { describe, expect, it } from "vitest";
import {
  indexSupplierCatalog,
  matchSupplierNumber,
} from "@/modules/phones/supplier-match";

const index = indexSupplierCatalog([
  { id: "a", endpointNumber: "74951234567" },
  { id: "b", endpointNumber: "74951234567" },
  { id: "c", endpointNumber: "1234" },
  { id: "d", endpointNumber: "7 (900) 111-22-33" },
]);

describe("matchSupplierNumber", () => {
  it("matches every row with the same trimmed number", () => {
    expect(matchSupplierNumber("74951234567", index).map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("matches digits and the 7/8 PSTN key without attaching a short number", () => {
    expect(matchSupplierNumber("7 495 123-45-67", index).map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
    expect(matchSupplierNumber("84951234567", index).map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
    expect(matchSupplierNumber("4951234567", index).map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
    expect(matchSupplierNumber("1234", index).map((row) => row.id)).toEqual(["c"]);
    expect(matchSupplierNumber("234", index)).toEqual([]);
    expect(matchSupplierNumber("89001112233", index).map((row) => row.id)).toEqual([
      "d",
    ]);
  });
});
