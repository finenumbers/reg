import { afterEach, describe, expect, it, vi } from "vitest";
import { readPstnJson } from "@/modules/numbering-resource/client";
import { NumberingClientError } from "@/modules/numbering-resource/errors";
import {
  EMPTY_NUMBERING_FILTERS,
  pstnListParams,
} from "@/modules/numbering-resource/filters";
import { PSTN_UNREACHABLE_HINT } from "@/modules/pstn/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PSTN numbering reader", () => {
  it("calls the current dataset without a key and without caching", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await readPstnJson(
      "/api/ranges",
      pstnListParams({ cursor: null, filters: EMPTY_NUMBERING_FILTERS }),
      "https://pstn.finenumbers.com/ranges",
      { clientIp: "203.0.113.10, 10.0.0.1" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(
      "https://pstn.finenumbers.com/api/ranges?pageSize=100&sort=abc%3Aasc%2CrangeStart%3Aasc&page=1",
    );
    expect(String(url)).not.toContain("dataset");
    expect(init.cache).toBe("no-store");
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
    expect(headers["X-Forwarded-For"]).toBeUndefined();
  });

  it("forwards one client address", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await readPstnJson("/api/summary", new URLSearchParams(), "http://pstn_app:5555", {
      clientIp: "203.0.113.10",
    });

    const headers = (fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers["X-Forwarded-For"]).toBe("203.0.113.10");
    expect(headers["X-Real-IP"]).toBe("203.0.113.10");
  });

  it("treats an NPM html page as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("<html>login</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }),
    );

    await expect(
      readPstnJson("/api/ranges", new URLSearchParams(), "https://pstn.finenumbers.com"),
    ).rejects.toMatchObject({
      code: "NETWORK",
      message: PSTN_UNREACHABLE_HINT,
    });
  });

  it("passes the PSTN rate-limit message through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: "RATE_LIMITED",
              message: "Слишком много запросов. Повторите через 3 сек.",
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }),
    );

    await expect(
      readPstnJson("/api/ranges/facets", new URLSearchParams(), "http://pstn_app:5555"),
    ).rejects.toBeInstanceOf(NumberingClientError);
    await expect(
      readPstnJson("/api/ranges/facets", new URLSearchParams(), "http://pstn_app:5555"),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "Слишком много запросов. Повторите через 3 сек.",
    });
  });

  it("keeps Retry-After for one capped wait", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ error: { message: "Подождите" } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "2" },
        });
      }),
    );

    await expect(
      readPstnJson("/api/ranges", new URLSearchParams(), "http://pstn_app:5555"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 2 });
  });
});
