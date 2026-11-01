import { afterEach, describe, expect, it, vi } from "vitest";
import { DidClientError, listDidFreeNumbers, listDidNumbers } from "@/modules/did/client";
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
    await expect(
      listDidFreeNumbers({ page: 1, pageSize: 500, filters: {}, phoneQ: "" }, creds, 1000),
    ).rejects.toMatchObject({
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
    await expect(
      listDidFreeNumbers({ page: 1, pageSize: 500, filters: {}, phoneQ: "" }, creds, 1000),
    ).rejects.toMatchObject({
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
      await listDidFreeNumbers({ page: 1, pageSize: 500, filters: {}, phoneQ: "" }, creds, 1000);
      expect.fail("expected a 422");
    } catch (error) {
      expect(error).toBeInstanceOf(DidClientError);
      expect((error as DidClientError).httpStatus).toBe(422);
      expect((error as DidClientError).pageSizeLimit).toBeUndefined();
    }
  });

  it("reads purchased numbers on their own path and rejects the other catalog", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [{ id: "1", inventory_kind: "purchased" }],
        total: 1,
        page: 1,
        page_size: 1,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await listDidNumbers(
      "purchased",
      { page: 1, pageSize: 1, filters: {}, phoneQ: "" },
      creds,
      1000,
    );
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/backend/api/v1/numbers/purchased?");
    expect(url).not.toContain("/numbers/free");
    expect(url).not.toContain("export-jobs");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          items: [{ id: "1", inventory_kind: "free" }],
          total: 1,
          page: 1,
          page_size: 1,
        }),
      ),
    );
    await expect(
      listDidNumbers(
        "purchased",
        { page: 1, pageSize: 1, filters: {}, phoneQ: "" },
        creds,
        1000,
      ),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});
