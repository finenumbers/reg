import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import {
  classifyCdrRow,
  isCdrEmpty,
  isCdrFilled,
  isSideKnown,
  PARKING_DIAL_OBJECT,
} from "@/modules/enrich/row-flags";
import { PARKING_DST } from "@/modules/stats/classify";

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

describe("PARKING_DIAL_OBJECT", () => {
  it("stays equal to stats PARKING_DST", () => {
    expect(PARKING_DIAL_OBJECT).toBe(PARKING_DST);
  });
});

describe("isSideKnown", () => {
  it("rejects empty and billing-miss labels", () => {
    expect(isSideKnown("")).toBe(false);
    expect(isSideKnown(MISSING_BILLING_LABEL)).toBe(false);
    expect(isSideKnown("Офис")).toBe(true);
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
        dialObject: "",
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
        dialObject: "",
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
        dialObject: "",
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
        dialObject: "",
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
        dialObject: "",
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
        dialObject: "",
      }),
    ).toBeNull();
  });

  it("marks parking with only side A known", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: "Офис",
        sideB: MISSING_BILLING_LABEL,
        dialObject: PARKING_DIAL_OBJECT,
      }),
    ).toBe("parking_known");
  });

  it("marks parking with only side B known", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: MISSING_BILLING_LABEL,
        sideB: "Офис",
        dialObject: PARKING_DIAL_OBJECT,
      }),
    ).toBe("parking_known");
  });

  it("marks parking when both sides are known", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: "Клиент A",
        sideB: "Клиент B",
        dialObject: PARKING_DIAL_OBJECT,
      }),
    ).toBe("parking_known");
  });

  it("keeps parking with both billing misses as phantom", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: MISSING_BILLING_LABEL,
        sideB: MISSING_BILLING_LABEL,
        dialObject: PARKING_DIAL_OBJECT,
      }),
    ).toBe("phantom");
  });

  it("does not mark a parking suffix as parking_known", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: "Офис",
        sideB: MISSING_BILLING_LABEL,
        dialObject: "Service_Parking_1",
      }),
    ).toBeNull();
  });

  it("trims dial object before matching parking", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: "Офис",
        sideB: MISSING_BILLING_LABEL,
        dialObject: " Service_Parking ",
      }),
    ).toBe("parking_known");
  });

  it("returns null for parking while sides are still blank", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: "",
        sideB: "",
        dialObject: PARKING_DIAL_OBJECT,
      }),
    ).toBeNull();
  });

  it("keeps call_error ahead of parking_known", () => {
    expect(
      classifyCdrRow({
        aNumber: "",
        bNumber: "",
        sideA: "Офис",
        sideB: MISSING_BILLING_LABEL,
        dialObject: PARKING_DIAL_OBJECT,
      }),
    ).toBe("call_error");
  });

  it("marks a known side with empty duration as known_empty_duration", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: "Офис",
        sideB: MISSING_BILLING_LABEL,
        dialObject: "",
        elapsedTime: "",
      }),
    ).toBe("known_empty_duration");
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "",
        sideA: MISSING_BILLING_LABEL,
        sideB: "Офис",
        dialObject: "",
        elapsedTime: "",
      }),
    ).toBe("known_empty_duration");
  });

  it("does not treat missing or zero duration as empty", () => {
    const row = {
      aNumber: "79001112233",
      bNumber: "79004445566",
      sideA: "Офис",
      sideB: MISSING_BILLING_LABEL,
      dialObject: "",
    };
    expect(classifyCdrRow(row)).toBeNull();
    expect(classifyCdrRow({ ...row, elapsedTime: "0" })).toBeNull();
    expect(classifyCdrRow({ ...row, elapsedTime: "24383" })).toBeNull();
  });

  it("keeps phantom and parking ahead of empty duration", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: MISSING_BILLING_LABEL,
        sideB: MISSING_BILLING_LABEL,
        dialObject: "",
        elapsedTime: "",
      }),
    ).toBe("phantom");
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: "Офис",
        sideB: MISSING_BILLING_LABEL,
        dialObject: PARKING_DIAL_OBJECT,
        elapsedTime: "",
      }),
    ).toBe("parking_known");
    expect(
      classifyCdrRow({
        aNumber: "",
        bNumber: "",
        sideA: "Офис",
        sideB: MISSING_BILLING_LABEL,
        dialObject: "",
        elapsedTime: "",
      }),
    ).toBe("call_error");
  });

  it("marks a parking suffix with empty duration as known_empty_duration", () => {
    expect(
      classifyCdrRow({
        aNumber: "79001112233",
        bNumber: "79004445566",
        sideA: "Офис",
        sideB: MISSING_BILLING_LABEL,
        dialObject: "Service_Parking_1",
        elapsedTime: "",
      }),
    ).toBe("known_empty_duration");
  });
});
