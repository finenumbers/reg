import { describe, expect, it } from "vitest";
import { buildPhoneDescriptionMap } from "@/modules/registrations/phone-description";

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
