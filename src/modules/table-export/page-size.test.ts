import { describe, expect, it } from "vitest";
import { NumberingClientError } from "@/modules/numbering-resource/errors";
import { loadNumberingExportPage } from "@/modules/table-export/page-size";

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
