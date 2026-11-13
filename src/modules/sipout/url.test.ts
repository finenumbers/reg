import { describe, expect, it } from "vitest";
import { SIPOUT_ORIGIN, sipoutUrl } from "@/modules/sipout/url";

const KEY = "super-secret-key";

describe("sipout URL", () => {
  it("builds only the three did reads", () => {
    const cities = new URL(sipoutUrl(KEY, { action: "get_cities" })!);
    expect(cities.origin).toBe(SIPOUT_ORIGIN);
    expect(cities.pathname).toBe("/userapi/");
    expect(cities.searchParams.get("method")).toBe("did");
    expect(cities.searchParams.get("action")).toBe("get_cities");
    expect(cities.searchParams.get("city_id")).toBeNull();
    expect(cities.searchParams.get("mask")).toBeNull();
    expect([...cities.searchParams.keys()].sort()).toEqual(["action", "key", "method"]);

    const connected = new URL(sipoutUrl(KEY, { action: "connected_list" })!);
    expect(connected.searchParams.get("action")).toBe("connected_list");
    expect(connected.searchParams.get("city_id")).toBeNull();
    expect(connected.searchParams.get("mask")).toBeNull();

    const free = new URL(sipoutUrl(KEY, { action: "free_list", cityId: "41" })!);
    expect(free.searchParams.get("action")).toBe("free_list");
    expect(free.searchParams.get("city_id")).toBe("41");
    expect(free.searchParams.get("mask")).toBeNull();
    expect(free.searchParams.get("key")).toBe(KEY);
  });

  it("refuses a free_list without a numeric city id", () => {
    expect(sipoutUrl(KEY, { action: "free_list", cityId: "" })).toBeNull();
    expect(sipoutUrl(KEY, { action: "free_list", cityId: "41;drop" })).toBeNull();
    expect(sipoutUrl("", { action: "get_cities" })).toBeNull();
  });
});
