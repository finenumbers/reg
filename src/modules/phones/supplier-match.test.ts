import { describe, expect, it } from "vitest";
import {
  indexSupplierCatalog,
  matchSupplierFileRow,
  matchSupplierNumber,
} from "@/modules/phones/supplier-match";

const catalog = [
  { id: "a", endpointNumber: "74951234567" },
  { id: "b", endpointNumber: "74951234567" },
  { id: "c", endpointNumber: "1234" },
  { id: "d", endpointNumber: "7 (900) 111-22-33" },
  { id: "e", endpointNumber: "73833999999" },
  { id: "f", endpointNumber: "79039039900" },
  { id: "g", endpointNumber: "79133999999" },
];

const screen = [
  { id: "e", abc: "7383", telephone: "3999999" },
  { id: "f", abc: "903", telephone: "9039900" },
  { id: "g", abc: "913", telephone: "3999999" },
];

const index = indexSupplierCatalog(catalog, screen);

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

describe("matchSupplierFileRow", () => {
  it("matches display ABC from «Управление РТУ» by digit concat", () => {
    expect(
      matchSupplierFileRow({ abc: "7 (383)", telephone: "3999999" }, index).map(
        (row) => row.id,
      ),
    ).toEqual(["e"]);
    expect(
      matchSupplierFileRow({ abc: "7 (913)", telephone: "3999999" }, index).map(
        (row) => row.id,
      ),
    ).toEqual(["g"]);
    expect(
      matchSupplierFileRow({ abc: "7 (903)", telephone: "9039900" }, index).map(
        (row) => row.id,
      ),
    ).toEqual(["f"]);
  });

  it("matches raw screen abc+telephone for mobile DEF", () => {
    expect(
      matchSupplierFileRow({ abc: "903", telephone: "9039900" }, index).map(
        (row) => row.id,
      ),
    ).toEqual(["f"]);
    expect(
      matchSupplierFileRow({ abc: "7383", telephone: "3999999" }, index).map(
        (row) => row.id,
      ),
    ).toEqual(["e"]);
  });

  it("uses «Номер» alone when ABC is empty", () => {
    expect(
      matchSupplierFileRow({ abc: "", telephone: "74951234567" }, index).map(
        (row) => row.id,
      ),
    ).toEqual(["a", "b"]);
  });

  it("rejects an empty local part", () => {
    expect(matchSupplierFileRow({ abc: "7 (383)", telephone: "" }, index)).toEqual([]);
  });
});
