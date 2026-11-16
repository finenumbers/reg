import { describe, expect, it, vi } from "vitest";
import { createExolveClient } from "@/modules/exolve/client";
import { purchasedUrl, freeUrl, directoryUrl } from "@/modules/exolve/url";

function jsonResponse(body: unknown, status = 200, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

describe("Exolve client", () => {
  it("posts the unfiltered purchased body and does not follow a redirect", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ total: 0, numbers: [] }));
    const client = createExolveClient("secret-key", { fetchImpl });
    const page = await client.purchased({ kind: "all" }, 0);
    expect(page.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(purchasedUrl());
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.body).toBe(JSON.stringify({ limit: 1000, offset: 0 }));
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(String(init.body)).not.toContain("application_uuid");
    expect(String(init.body)).not.toContain("secret-key");
  });

  it("posts one free cell with random false and no mask", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ numbers: [] }));
    const client = createExolveClient("secret-key", { fetchImpl });
    const page = await client.free(
      { typeId: 1104, categoryId: 10000, regionId: 10230 },
      0,
    );
    expect(page.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(freeUrl());
    expect(JSON.parse(String(init.body))).toEqual({
      type_id: 1104,
      region_id: 10230,
      category_id: 10000,
      random: false,
      limit: 10,
      offset: 0,
    });
  });

  it("retries a transport failure once and does not retry HTTP 400 or an oversized body", async () => {
    const retry = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(jsonResponse({ total: 0, numbers: [] }));
    const client = createExolveClient("secret-key", { fetchImpl: retry });
    expect((await client.recount()).ok).toBe(true);
    expect(retry).toHaveBeenCalledTimes(2);

    const denied = vi.fn(async () => jsonResponse({ error: "invalid value" }, 400));
    const deniedClient = createExolveClient("secret-key", { fetchImpl: denied });
    const deniedPage = await deniedClient.directory();
    expect(deniedPage.ok).toBe(false);
    if (deniedPage.ok) return;
    expect(deniedPage.error).toContain("invalid value");
    expect(denied).toHaveBeenCalledTimes(1);
    expect((denied.mock.calls[0] as unknown as [string])[0]).toBe(directoryUrl());

    const huge = vi.fn(async () =>
      jsonResponse({ numbers: [] }, 200, { "content-length": String(21 * 1024 * 1024) }),
    );
    const hugeClient = createExolveClient("secret-key", { fetchImpl: huge });
    const hugePage = await hugeClient.free(
      { typeId: 1104, categoryId: 10000, regionId: 10084 },
      0,
    );
    expect(hugePage.ok).toBe(false);
    expect(huge).toHaveBeenCalledTimes(1);
  });

  it("fails a 200 error body without a second request and hides the key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "bad secret-key" }));
    const client = createExolveClient("secret-key", { fetchImpl });
    const page = await client.purchased({ kind: "all" }, 0);
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.error).not.toContain("secret-key");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const empty = vi.fn(async () => jsonResponse({}));
    const emptyClient = createExolveClient("secret-key", { fetchImpl: empty });
    const emptyPage = await emptyClient.free(
      { typeId: 1, categoryId: 2, regionId: 3 },
      0,
    );
    expect(emptyPage.ok).toBe(true);
    if (emptyPage.ok) expect(emptyPage.rows).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);

    const missing = vi.fn(async () => jsonResponse({ meta: 1 }));
    const missingClient = createExolveClient("secret-key", { fetchImpl: missing });
    expect(
      (await missingClient.free({ typeId: 1, categoryId: 2, regionId: 3 }, 0)).ok,
    ).toBe(false);
    expect(missing).toHaveBeenCalledTimes(1);
  });

  it("does not call the platform when the key is empty", async () => {
    const fetchImpl = vi.fn();
    const client = createExolveClient("", { fetchImpl });
    const page = await client.purchased({ kind: "all" }, 0);
    expect(page.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
