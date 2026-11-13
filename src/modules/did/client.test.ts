import { afterEach, describe, expect, it, vi } from "vitest";
import { DidClientError, listDidPurchasedNumbers } from "@/modules/did/client";
import {
  DID_TIMEOUT_MESSAGE,
  DID_UNAUTHORIZED_MESSAGE,
  DID_UNREACHABLE_HINT,
} from "@/modules/did/types";

const creds = {
  baseUrl: "http://did-frontend:3000/free-numbers",
  apiToken: "super-secret",
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

const purchasedPage = {
  items: [{ inventory_kind: "purchased", msisdn: "79039039900", provider_code: "mcn" }],
  total: 3,
  page: 1,
  page_size: 1,
};

describe("DID purchased client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the purchased catalog with the bearer header and no filter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, purchasedPage));
    vi.stubGlobal("fetch", fetchMock);

    const page = await listDidPurchasedNumbers(1, 1, creds, 1000);

    expect(page.total).toBe(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("http://did-frontend:3000/api/backend/api/v1/numbers/purchased?")).toBe(
      true,
    );
    expect(url).toContain("page=1");
    expect(url).toContain("page_size=1");
    expect(url).toContain("sort_by=abc_code");
    expect(url).not.toContain("filters=");
    expect(url).not.toContain("number_local_q=");
    expect(url).not.toContain("/numbers/free");
    expect(url).not.toContain("super-secret");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer super-secret");
  });

  it("maps 401 to a token error and does not treat it as a REG logout", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(401, { error: { message: "Требуется вход администратора" } }),
        ),
    );
    await expect(listDidPurchasedNumbers(1, 1, creds, 1000)).rejects.toMatchObject({
      name: "DidClientError",
      code: "UNAUTHORIZED",
      message: DID_UNAUTHORIZED_MESSAGE,
    });
  });

  it("maps a timeout and a network failure differently", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(listDidPurchasedNumbers(1, 1, creds, 1000)).rejects.toMatchObject({
      code: "TIMEOUT",
      message: DID_TIMEOUT_MESSAGE,
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
    await expect(listDidPurchasedNumbers(1, 1, creds, 1000)).rejects.toEqual(
      expect.any(DidClientError),
    );
    await expect(listDidPurchasedNumbers(1, 1, creds, 1000)).rejects.toMatchObject({
      code: "NETWORK",
      message: DID_UNREACHABLE_HINT,
    });
  });

  it("marks a page_size 422 with the announced cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, {
          detail: [
            {
              type: "less_than_equal",
              loc: ["query", "page_size"],
              msg: "Input should be less than or equal to 200",
              input: "500",
              ctx: { le: 200 },
            },
          ],
        }),
      ),
    );
    await expect(listDidPurchasedNumbers(1, 500, creds, 1000)).rejects.toMatchObject({
      code: "HTTP_ERROR",
      httpStatus: 422,
      pageSizeLimit: 200,
      message: "DID принимает не больше 200 строк на страницу",
    });
  });

  it("keeps a page_size 422 without a maximum distinct from other 422s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, {
          detail: [{ loc: ["query", "page_size"], msg: "invalid" }],
        }),
      ),
    );
    await expect(listDidPurchasedNumbers(1, 500, creds, 1000)).rejects.toMatchObject({
      httpStatus: 422,
      pageSizeLimit: null,
      message: "DID не принял размер страницы",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, {
          detail: [{ loc: ["query", "sort_dir"], msg: "bad" }],
        }),
      ),
    );
    try {
      await listDidPurchasedNumbers(1, 500, creds, 1000);
      expect.fail("expected a 422");
    } catch (error) {
      expect(error).toBeInstanceOf(DidClientError);
      expect((error as DidClientError).httpStatus).toBe(422);
      expect((error as DidClientError).pageSizeLimit).toBeUndefined();
    }
  });

  it("reads the purchased list and rejects another inventory", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [
          { inventory_kind: "purchased", msisdn: "79039039900", provider_code: "mcn" },
        ],
        total: 1,
        page: 1,
        page_size: 500,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const page = await listDidPurchasedNumbers(1, 500, creds, 1000);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/numbers/purchased?");
    expect(url).toContain("page_size=500");
    expect(url).not.toContain("filters=");
    expect(url).not.toContain("number_local_q=");
    expect(page.items).toHaveLength(1);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          items: [{ inventory_kind: "free", msisdn: "79039039900" }],
          total: 1,
          page: 1,
          page_size: 1,
        }),
      ),
    );
    await expect(listDidPurchasedNumbers(1, 1, creds, 1000)).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });
});
