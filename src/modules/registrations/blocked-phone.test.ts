import { describe, expect, it } from "vitest";
import { blockedRegistrationPhones } from "@/modules/registrations/blocked-phone";
import { buildPhoneEndpointEnrichmentMap } from "@/modules/registrations/phone-description";

describe("blockedRegistrationPhones", () => {
  it("blocks a number when a later catalog row is blocked and keeps the first description", () => {
    const rows = [
      {
        endpointNumber: " 73852222205 ",
        name: "first",
        data: { Описание: "Клиент", Статус: "Активно" },
      },
      {
        endpointNumber: "73852222205",
        name: "second",
        data: { Описание: "Другой", Статус: "Заблокировано" },
      },
      {
        endpointNumber: "100",
        name: "short",
        data: { Статус: "Активно" },
      },
      {
        endpointNumber: " ",
        name: "blank",
        data: { Статус: "Заблокировано" },
      },
    ];
    expect([...blockedRegistrationPhones(rows)]).toEqual(["73852222205"]);
    expect(buildPhoneEndpointEnrichmentMap(rows).get("73852222205")).toEqual({
      description: "Клиент",
      channelality: null,
    });
  });
});
