import { describe, expect, it } from "vitest";
import { DidClientError } from "@/modules/did/client";
import { NumberingClientError } from "@/modules/numbering-resource/errors";
import {
  catalogRetryPageSize,
  loadCatalogPage,
  loadNumberingExportPage,
  nextCatalogPageSize,
} from "@/modules/table-export/page-size";

const pageSizeRejection = (limit: number | null) =>
  new DidClientError("HTTP_ERROR", "page", 422, limit);

describe("catalog page size", () => {
  it("steps down to the announced cap, then stops", () => {
    expect(nextCatalogPageSize(500, 200)).toBe(200);
    expect(nextCatalogPageSize(200, 200)).toBeNull();
    expect(nextCatalogPageSize(500, null)).toBe(200);
    expect(nextCatalogPageSize(200, null)).toBe(100);
    expect(nextCatalogPageSize(100, null)).toBeNull();
  });

  it("does not shrink a timeout or a 422 that is not about page size", () => {
    expect(catalogRetryPageSize(500, new DidClientError("TIMEOUT", "slow"))).toBeNull();
    expect(catalogRetryPageSize(500, new DidClientError("HTTP_ERROR", "down", 503))).toBeNull();
    expect(catalogRetryPageSize(500, new DidClientError("HTTP_ERROR", "other", 422))).toBeNull();
  });

  it("retries the first page at 200 and keeps that size for the next page", async () => {
    const sizes: number[] = [];
    const rejection = pageSizeRejection(200);
    const first = await loadCatalogPage({
      page: 1,
      pageSize: 500,
      load: async (size) => {
        sizes.push(size);
        if (size === 500) throw rejection;
        return { items: Array.from({ length: size }, (_, i) => i), total: 400 };
      },
    });
    expect(sizes).toEqual([500, 200]);
    expect(first.pageSize).toBe(200);

    sizes.length = 0;
    const second = await loadCatalogPage({
      page: 2,
      pageSize: first.pageSize,
      load: async (size) => {
        sizes.push(size);
        return { items: [1], total: 400 };
      },
    });
    expect(sizes).toEqual([200]);
    expect(second.pageSize).toBe(200);
  });

  it("does not shrink a later page or a timeout on the first page", async () => {
    const rejection = pageSizeRejection(200);
    const later: number[] = [];
    await expect(
      loadCatalogPage({
        page: 2,
        pageSize: 500,
        load: async (size) => {
          later.push(size);
          throw rejection;
        },
      }),
    ).rejects.toBe(rejection);
    expect(later).toEqual([500]);

    const timeout = new DidClientError("TIMEOUT", "slow");
    const timed: number[] = [];
    await expect(
      loadCatalogPage({
        page: 1,
        pageSize: 500,
        load: async (size) => {
          timed.push(size);
          throw timeout;
        },
      }),
    ).rejects.toBe(timeout);
    expect(timed).toEqual([500]);
  });

  it("walks 500, then 200, then 100 when the body has no maximum", async () => {
    const sizes: number[] = [];
    const rejection = pageSizeRejection(null);
    await expect(
      loadCatalogPage({
        page: 1,
        pageSize: 500,
        load: async (size) => {
          sizes.push(size);
          throw rejection;
        },
      }),
    ).rejects.toBe(rejection);
    expect(sizes).toEqual([500, 200, 100]);
  });
});

describe("numbering export page size", () => {
  it("tries 200 once on the first page and then stays there", async () => {
    const sizes: number[] = [];
    const first = await loadNumberingExportPage({
      cursor: null,
      pageSize: 500,
      load: async (size) => {
        sizes.push(size);
        if (size === 500) throw new NumberingClientError("HTTP_ERROR", "cap", 400);
        return "ok";
      },
    });
    expect(sizes).toEqual([500, 200]);
    expect(first.pageSize).toBe(200);

    sizes.length = 0;
    const second = await loadNumberingExportPage({
      cursor: "next",
      pageSize: first.pageSize,
      load: async (size) => {
        sizes.push(size);
        return "more";
      },
    });
    expect(sizes).toEqual([200]);
    expect(second.pageSize).toBe(200);
  });

  it("returns the original 400 when 200 is also rejected", async () => {
    const first = new NumberingClientError("HTTP_ERROR", "first", 400);
    const second = new NumberingClientError("HTTP_ERROR", "second", 400);
    await expect(
      loadNumberingExportPage({
        cursor: null,
        pageSize: 500,
        load: async (size) => {
          throw size === 500 ? first : second;
        },
      }),
    ).rejects.toBe(first);
  });

  it("does not hide a timeout or a 400 on a later page", async () => {
    const timeout = new NumberingClientError("TIMEOUT", "slow");
    await expect(
      loadNumberingExportPage({
        cursor: null,
        pageSize: 500,
        load: async (size) => {
          if (size === 500) throw new NumberingClientError("HTTP_ERROR", "cap", 400);
          throw timeout;
        },
      }),
    ).rejects.toBe(timeout);

    const later = new NumberingClientError("HTTP_ERROR", "later", 400);
    const sizes: number[] = [];
    await expect(
      loadNumberingExportPage({
        cursor: "next",
        pageSize: 500,
        load: async (size) => {
          sizes.push(size);
          throw later;
        },
      }),
    ).rejects.toBe(later);
    expect(sizes).toEqual([500]);
  });
});
