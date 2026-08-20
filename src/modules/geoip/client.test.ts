import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupIpGeo } from "@/modules/geoip/client";

describe("geoip HTTP client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs lookup with X-API-Key and maps the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ip: "8.8.8.8",
        country: { countryName: "United States" },
        city: { cityName: "Mountain View" },
        asn: { organization: "GOOGLE" },
        meta: { datasetDate: "20260801" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const fields = await lookupIpGeo("8.8.8.8", {
      baseUrl: "http://localhost:8080",
      apiKey: "secret-key",
    });

    expect(fields).toEqual({
      country: "United States",
      city: "Mountain View",
      isp: "GOOGLE",
      datasetDate: "20260801",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8080/api/v1/lookup");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("secret-key");
    expect(headers["X-GeoIP-Client-Auth"]).toBe("1");
    expect(JSON.parse(String(init.body))).toEqual({
      ip: "8.8.8.8",
      include: ["city", "country", "asn"],
    });
  });

  it("maps 401 to UNAUTHORIZED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );
    await expect(
      lookupIpGeo("8.8.8.8", { baseUrl: "http://localhost:8080", apiKey: "x" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
