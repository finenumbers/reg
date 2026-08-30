import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import {
  classifyCdrRow,
  isCdrEmpty,
  isCdrFilled,
} from "@/modules/enrich/row-flags";

describe("isCdrEmpty / isCdrFilled", () => {
  it("treats only the empty string as empty", () => {
    expect(isCdrEmpty("")).toBe(true);
    expect(isCdrEmpty(" ")).toBe(false);
    expect(isCdrEmpty("7900")).toBe(false);
    expect(isCdrFilled("")).toBe(false);
    expect(isCdrFilled(" ")).toBe(true);
    expect(isCdrFilled("7900")).toBe(true);
  });
});

describe("classifyCdrRow", () => {
  it("marks both empty numbers as a call error", () => {
    expect(
      classifyCdrRow({
        aNumber: "",
        bNumber: "",
        sideA: MISSING_BILLING_LABEL,
        sideB: MISSING_BILLING_LABEL,
      }),
    ).toBe("call_error");
  });

  it("does not treat a space as empty", () => {
    expect(
      classifyCdrRow({
        aNumber: " ",
        bNumber: " ",
        sideA: MISSING_BILLING_LABEL,
        sideB: MISSING_BILLING_LABEL,
      }),
    ).toBe("phantom");
  });

  it("marks filled numbers with both billing misses as phantom", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: MISSING_BILLING_LABEL,
        sideB: MISSING_BILLING_LABEL,
      }),
    ).toBe("phantom");
  });

  it("returns null when only one number is empty", () => {
    expect(
      classifyCdrRow({
        aNumber: "",
        bNumber: "79004445566",
        sideA: MISSING_BILLING_LABEL,
        sideB: "Офис",
      }),
    ).toBeNull();
  });

  it("returns null when sides are not both missing", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: MISSING_BILLING_LABEL,
        sideB: "Офис",
      }),
    ).toBeNull();
  });

  it("returns null when sides are still blank before enrich", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: "",
        sideB: "",
      }),
    ).toBeNull();
  });
});
