import { describe, expect, it } from "vitest";
import { excelPhoneValue } from "@/modules/enrich/excel-phone";

describe("excelPhoneValue", () => {
  it("writes 11-digit Russian numbers as Excel numbers", () => {
    expect(excelPhoneValue("79505765234")).toBe(79505765234);
    expect(excelPhoneValue("73843222200")).toBe(73843222200);
  });

  it("accepts 1–15 digits after trim", () => {
    expect(excelPhoneValue(" 7 ")).toBe(7);
    expect(excelPhoneValue("123456789012345")).toBe(123456789012345);
  });

  it("keeps non-digit and empty values as text", () => {
    expect(excelPhoneValue("")).toBe("");
    expect(excelPhoneValue("+79505765234")).toBe("'+79505765234");
    expect(excelPhoneValue("7950 5765234")).toBe("7950 5765234");
    expect(excelPhoneValue("1234567890123456")).toBe("1234567890123456");
  });
});
