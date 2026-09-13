import { describe, expect, it } from "vitest";
import {
  buildPhoneDescriptionMap,
  buildPhoneEndpointEnrichmentMap,
} from "@/modules/registrations/phone-description";

describe("buildPhoneDescriptionMap", () => {
  it("maps Описание by endpoint number", () => {
    const map = buildPhoneDescriptionMap([
      {
        endpointNumber: "79001112233",
        name: "ep-a",
        data: { Описание: "  Клиент А  " },
      },
    ]);
    expect(map.get("79001112233")).toBe("Клиент А");
  });

  it("skips missing number, empty Описание, and keeps first duplicate", () => {
    const map = buildPhoneDescriptionMap([
      {
        endpointNumber: null,
        name: "skip",
        data: { Описание: "X" },
      },
      {
        endpointNumber: "100",
        name: "first",
        data: { Описание: "Первый" },
      },
      {
        endpointNumber: "100",
        name: "second",
        data: { Описание: "Второй" },
      },
      {
        endpointNumber: "200",
        name: "empty",
        data: { Описание: "   " },
      },
      {
        endpointNumber: "300",
        name: "no-field",
        data: { Название: "only-name" },
      },
    ]);
    expect(map.get("100")).toBe("Первый");
    expect(map.has("200")).toBe(false);
    expect(map.has("300")).toBe(false);
    expect(map.size).toBe(1);
  });
});

describe("buildPhoneEndpointEnrichmentMap", () => {
  it("reads ИНИЦ. емкость as string or number", () => {
    const map = buildPhoneEndpointEnrichmentMap([
      {
        endpointNumber: "100",
        name: "a",
        data: { "ИНИЦ. емкость": " 10 ", Описание: "Клиент" },
      },
      {
        endpointNumber: "200",
        name: "b",
        data: { "ИНИЦ. емкость": 30 },
      },
    ]);
    expect(map.get("100")).toEqual({
      description: "Клиент",
      channelality: " 10 ",
    });
    expect(map.get("200")).toEqual({
      description: null,
      channelality: "30",
    });
  });

  it("keeps empty capacity as null, including whitespace-only and missing key", () => {
    const map = buildPhoneEndpointEnrichmentMap([
      { endpointNumber: "100", name: "empty", data: { "ИНИЦ. емкость": "" } },
      { endpointNumber: "200", name: "spaces", data: { "ИНИЦ. емкость": "   " } },
      { endpointNumber: "300", name: "missing", data: { Описание: "X" } },
      { endpointNumber: "400", name: "zero", data: { "ИНИЦ. емкость": "0" } },
    ]);
    expect(map.get("100")?.channelality).toBeNull();
    expect(map.get("200")?.channelality).toBeNull();
    expect(map.get("300")?.channelality).toBeNull();
    expect(map.get("300")?.description).toBe("X");
    expect(map.get("400")?.channelality).toBe("0");
    expect(map.has("999")).toBe(false);
  });

  it("skips missing numbers and keeps the first duplicate", () => {
    const map = buildPhoneEndpointEnrichmentMap([
      {
        endpointNumber: null,
        name: "skip",
        data: { "ИНИЦ. емкость": "1" },
      },
      {
        endpointNumber: "100",
        name: "first",
        data: { "ИНИЦ. емкость": "2" },
      },
      {
        endpointNumber: "100",
        name: "second",
        data: { "ИНИЦ. емкость": "9" },
      },
    ]);
    expect(map.get("100")?.channelality).toBe("2");
    expect(map.size).toBe(1);
  });
});
