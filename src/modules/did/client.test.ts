import { afterEach, describe, expect, it, vi } from "vitest";
import { DidClientError, listDidFreeNumbers } from "@/modules/did/client";
import {
  DID_TIMEOUT_MESSAGE,
  DID_UNAUTHORIZED_MESSAGE,
  DID_UNREACHABLE_HINT,
} from "@/modules/did/types";

const creds = { baseUrl: "http://did-frontend:3000/free-numbers", apiToken: "super-secret" };

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("DID free-number client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the UI proxy with the bearer header and a literal phone search", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], total: 3, page: 1, page_size: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await listDidFreeNumbers(
      {
        page: 1,
        pageSize: 1,
        filters: { region_name: ["Москва"] },
        phoneQ: "12%3",
      },
      creds,
      1000,
    );

    expect(page.total).toBe(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("http://did-frontend:3000/api/backend/api/v1/numbers/free?")).toBe(
      true,
    );
    expect(url).toContain("sort_by=abc_code");
    expect(url).toContain("sort_dir=asc");
    expect(url).toContain("number_local_q=12%5C%253");
    expect(url).not.toContain("super-secret");
    expect(url).not.toContain("/free-numbers");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer super-secret");
  });

  it("maps 401 to a token error and does not treat it as a REG logout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(401, { error: { message: "Требуется вход администратора" } }),
      ),
    );
    await expect(
      listDidFreeNumbers({ page: 1, pageSize: 1, filters: {}, phoneQ: "" }, creds, 1000),
    ).rejects.toMatchObject({
      name: "DidClientError",
      code: "UNAUTHORIZED",
      message: DID_UNAUTHORIZED_MESSAGE,
    });
  });

  it("maps a timeout and a network failure differently", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(
      listDidFreeNumbers({ page: 1, pageSize: 1, filters: {}, phoneQ: "" }, creds, 1000),
    ).rejects.toMatchObject({ code: "TIMEOUT", message: DID_TIMEOUT_MESSAGE });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
    await expect(
      listDidFreeNumbers({ page: 1, pageSize: 1, filters: {}, phoneQ: "" }, creds, 1000),
    ).rejects.toEqual(expect.any(DidClientError));
    await expect(
      listDidFreeNumbers({ page: 1, pageSize: 1, filters: {}, phoneQ: "" }, creds, 1000),
    ).rejects.toMatchObject({ code: "NETWORK", message: DID_UNREACHABLE_HINT });
  });
});
