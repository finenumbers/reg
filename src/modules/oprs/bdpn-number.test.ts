import { describe, expect, it } from "vitest";
import { bdpnNumberFromBillDnis } from "@/modules/oprs/bdpn-number";

describe("bdpnNumberFromBillDnis", () => {
  it("drops one leading 7 from a mobile RF number", () => {
    expect(bdpnNumberFromBillDnis("79030768600")).toBe("9030768600");
    expect(bdpnNumberFromBillDnis(" 79030768600 ")).toBe("9030768600");
  });

  it("rejects a city number, a national ten-digit number, an 8, and internal spaces", () => {
    expect(bdpnNumberFromBillDnis("74951234567")).toBeNull();
    expect(bdpnNumberFromBillDnis("9030768600")).toBeNull();
    expect(bdpnNumberFromBillDnis("89030768600")).toBeNull();
    expect(bdpnNumberFromBillDnis("79 030768600")).toBeNull();
    expect(bdpnNumberFromBillDnis("")).toBeNull();
  });
});
