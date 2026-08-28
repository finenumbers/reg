import { describe, expect, it } from "vitest";
import {
  mapPstnLookupResponse,
  normalizePstnPhone,
  pstnLookupUrl,
  resolvePstnBaseUrl,
} from "@/modules/pstn/types";

describe("PSTN phone normalize", () => {
  it("drops leading 7/8 from 11 digits", () => {
    expect(normalizePstnPhone("79505765234")).toBe("9505765234");
    expect(normalizePstnPhone("89505765234")).toBe("9505765234");
  });

  it("keeps 10 digits", () => {
    expect(normalizePstnPhone("4996660000")).toBe("4996660000");
  });

  it("rejects junk", () => {
    expect(normalizePstnPhone("10")).toBeNull();
    expect(normalizePstnPhone("090059")).toBeNull();
    expect(normalizePstnPhone("")).toBeNull();
  });
});

describe("PSTN mapping", () => {
  it("builds lookup URL", () => {
    expect(pstnLookupUrl("https://pstn.finenumbers.com/", "4996660000")).toBe(
      "https://pstn.finenumbers.com/api/v1/lookup?phone=4996660000",
    );
    expect(resolvePstnBaseUrl("")).toBe("https://pstn.finenumbers.com");
  });

  it("maps found and not found", () => {
    expect(
      mapPstnLookupResponse({
        found: true,
        data: { operator: "МТС", garTerritory: "г. Москва" },
      }),
    ).toEqual({
      found: true,
      operator: "МТС",
      garTerritory: "г. Москва",
    });
    expect(mapPstnLookupResponse({ found: false, phone: "1" })).toEqual({
      found: false,
      operator: null,
      garTerritory: null,
    });
  });
});
