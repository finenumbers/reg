import { describe, expect, it } from "vitest";
import {
  geoipLookupUrl,
  isGeoCacheFresh,
  isLookupIpv4,
  mapLookupResponse,
  normalizeGeoipBaseUrl,
  uniqueLookupIps,
} from "@/modules/geoip/types";

describe("geoip types and mapping", () => {
  it("normalizes origin and builds lookup URL", () => {
    expect(normalizeGeoipBaseUrl("http://localhost:8080/")).toBe(
      "http://localhost:8080",
    );
    expect(normalizeGeoipBaseUrl("https://geoip.example.com/api/v1")).toBe(
      "https://geoip.example.com",
    );
    expect(geoipLookupUrl("http://localhost:8080")).toBe(
      "http://localhost:8080/api/v1/lookup",
    );
  });

  it("accepts IPv4 only", () => {
    expect(isLookupIpv4("46.20.69.189")).toBe(true);
    expect(isLookupIpv4("8.8.8.8")).toBe(true);
    expect(isLookupIpv4(null)).toBe(false);
    expect(isLookupIpv4("999.1.1.1")).toBe(false);
    expect(isLookupIpv4("2001:db8::1")).toBe(false);
    expect(uniqueLookupIps(["1.2.3.4", "1.2.3.4", null, "bad"])).toEqual([
      "1.2.3.4",
    ]);
  });

  it("treats cache younger than 24h as fresh", () => {
    const now = new Date("2026-08-21T00:00:00.000Z");
    expect(
      isGeoCacheFresh(new Date("2026-08-20T12:00:00.000Z"), now),
    ).toBe(true);
    expect(
      isGeoCacheFresh(new Date("2026-08-19T23:59:00.000Z"), now),
    ).toBe(false);
  });

  it("maps GRCHC lookup JSON to country / city / isp", () => {
    expect(
      mapLookupResponse({
        ip: "46.20.69.189",
        city: { cityName: "Москва", countryName: "Россия" },
        country: { countryName: "Российская Федерация", countryIsoCode: "RU" },
        asn: { asn: 123, organization: "Ростелеком" },
        meta: { datasetDate: "20260801" },
      }),
    ).toEqual({
      country: "Российская Федерация",
      city: "Москва",
      isp: "Ростелеком",
      datasetDate: "20260801",
    });
  });

  it("falls back to city.countryName and caches empty sections", () => {
    expect(
      mapLookupResponse({
        ip: "8.8.8.8",
        city: { cityName: null, countryName: "United States" },
        country: null,
        asn: { organization: "  " },
        meta: {},
      }),
    ).toEqual({
      country: "United States",
      city: null,
      isp: null,
      datasetDate: null,
    });
  });
});
