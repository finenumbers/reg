import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DUPLICATE_NUMBER, type FreeRow } from "@/modules/mcn/parse";
import { FREE_PAGE_LIMIT } from "@/modules/mcn/url";
import {
  SHORT_LIST,
  TOTAL_MOVED,
  runAccessProbe,
  runMcnFreeWalk,
  runMcnPurchasedWalk,
  type Gate,
} from "@/modules/mcn/walk";

const meta = { status: 200, attempts: 1, durationMs: 1 };

function did(index: number): string {
  return `7495${String(index).padStart(7, "0")}`;
}

function row(index: number, purchase = "10", period = "1"): FreeRow {
  return { e164: did(index), incomingPurchase: purchase, incomingPeriod: period };
}

function rows(start: number, count: number): FreeRow[] {
  return Array.from({ length: count }, (_, index) => row(start + index));
}

function purchased(rows: string[], total: number, echo: number) {
  return { ok: true as const, rows, total, echo, meta };
}

function free(rows: FreeRow[], total: number, echo: number) {
  return { ok: true as const, rows, total, echo, meta };
}

const beat = async (): Promise<Gate> => "run";

describe("MCN Telecom purchased walk", () => {
  it("does not stage a failed purchased page", async () => {
    let staged = 0;
    const result = await runMcnPurchasedWalk({
      beat,
      purchasedPage: async () => ({
        ok: false,
        error: "Площадка отклонила запрос.",
        meta,
      }),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
      stagePurchased: async () => {
        staged += 1;
      },
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(staged).toBe(0);
  });

  it("rejects a purchased offset that does not echo", async () => {
    let staged = 0;
    const result = await runMcnPurchasedWalk({
      beat,
      purchasedPage: async () => purchased([did(1)], 1, 5),
      purchasedRecount: async () => ({ ok: true, total: 1, meta }),
      stagePurchased: async () => {
        staged += 1;
      },
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(staged).toBe(0);
  });

  it("advances a short purchased page", async () => {
    const offsets: number[] = [];
    let staged: string[] = [];
    const result = await runMcnPurchasedWalk({
      beat,
      purchasedPage: async (offset) => {
        offsets.push(offset);
        if (offset === 0) return purchased([did(1), did(2)], 3, 0);
        return purchased([did(3)], 3, offset);
      },
      purchasedRecount: async () => ({ ok: true, total: 3, meta }),
      stagePurchased: async (got) => {
        staged = [...got];
      },
      log: async () => undefined,
    });
    expect(result).toEqual({ ok: true, inserted: 3 });
    expect(offsets).toEqual([0, 2]);
    expect(staged).toEqual([did(1), did(2), did(3)]);
  });

  it("returns an empty purchased list", async () => {
    let staged = 0;
    const result = await runMcnPurchasedWalk({
      beat,
      purchasedPage: async () => purchased([], 0, 0),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
      stagePurchased: async () => {
        staged += 1;
      },
      log: async () => undefined,
    });
    expect(result).toEqual({ ok: true, inserted: 0 });
    expect(staged).toBe(0);
  });

  it("reads a moved total once more and stops on the second move", async () => {
    let pass = 0;
    let staged = 0;
    const once = await runMcnPurchasedWalk({
      beat,
      purchasedPage: async (offset) => purchased([did(1)], 1, offset),
      purchasedRecount: async () => {
        pass += 1;
        return { ok: true, total: pass === 1 ? 2 : 1, meta };
      },
      stagePurchased: async () => {
        staged += 1;
      },
      log: async () => undefined,
    });
    expect(once).toEqual({ ok: true, inserted: 1 });
    expect(pass).toBe(2);
    expect(staged).toBe(1);

    const twice = await runMcnPurchasedWalk({
      beat,
      purchasedPage: async (offset) => purchased([did(1)], 1, offset),
      purchasedRecount: async () => ({ ok: true, total: 2, meta }),
      stagePurchased: async () => undefined,
      log: async () => undefined,
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error).toBe(TOTAL_MOVED);
  });

  it("stops a purchased duplicate on the first page", async () => {
    let calls = 0;
    let staged = 0;
    const result = await runMcnPurchasedWalk({
      beat,
      purchasedPage: async (offset) => {
        calls += 1;
        return purchased([did(1), did(1)], 2, offset);
      },
      purchasedRecount: async () => ({ ok: true, total: 2, meta }),
      stagePurchased: async () => {
        staged += 1;
      },
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(DUPLICATE_NUMBER);
    expect(calls).toBe(1);
    expect(staged).toBe(0);
  });
});

describe("MCN Telecom free walk", () => {
  it("reads only prefix 7", async () => {
    const countriesAsked: number[] = [];
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [
          { code: 1, prefix: 1 },
          { code: 643, prefix: 7 },
        ],
        meta,
      }),
      freePage: async (countryCode) => {
        countriesAsked.push(countryCode);
        return free([], 0, 1);
      },
      freeRecount: async () => ({ ok: true, total: 0, meta }),
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result).toEqual({ ok: true, inserted: 0 });
    expect(countriesAsked).toEqual([643]);
  });

  it("accepts an empty free list when every country returns 0", async () => {
    let staged = 0;
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [
          { code: 643, prefix: 7 },
          { code: 644, prefix: 7 },
        ],
        meta,
      }),
      freePage: async () => free([], 0, 1),
      freeRecount: async () => ({ ok: true, total: 0, meta }),
      stageFree: async () => {
        staged += 1;
      },
      log: async () => undefined,
    });
    expect(result).toEqual({ ok: true, inserted: 0 });
    expect(staged).toBe(0);
  });

  it("retries a short free page at the same page and keeps the full page", async () => {
    const pages: number[] = [];
    let staged: FreeRow[] = [];
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async (_country, pageNumber) => {
        pages.push(pageNumber);
        const total = FREE_PAGE_LIMIT + 5;
        if (pages.length === 1) return free(rows(0, 10), total, pageNumber);
        if (pageNumber === 1) return free(rows(100, FREE_PAGE_LIMIT), total, pageNumber);
        return free(rows(100 + FREE_PAGE_LIMIT, 5), total, pageNumber);
      },
      freeRecount: async () => ({ ok: true, total: FREE_PAGE_LIMIT + 5, meta }),
      stageFree: async (got) => {
        staged = [...got];
      },
      log: async () => undefined,
    });
    expect(result).toEqual({ ok: true, inserted: FREE_PAGE_LIMIT + 5 });
    expect(pages).toEqual([1, 1, 2]);
    expect(staged).toHaveLength(FREE_PAGE_LIMIT + 5);
    expect(staged[0]?.e164).toBe(did(100));
  });

  it("fails a country when the short page repeats", async () => {
    let staged = 0;
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async (_country, pageNumber) =>
        free(
          Array.from({ length: 10 }, (_, i) => row(i)),
          30,
          pageNumber,
        ),
      freeRecount: async () => ({ ok: true, total: 30, meta }),
      stageFree: async () => {
        staged += 1;
      },
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(staged).toBe(0);
  });

  it("keeps the first price when a later country repeats a number", async () => {
    const staged: FreeRow[][] = [];
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [
          { code: 643, prefix: 7 },
          { code: 644, prefix: 7 },
        ],
        meta,
      }),
      freePage: async (countryCode, pageNumber) => {
        if (countryCode === 643) return free([row(1, "10", "1")], 1, pageNumber);
        return free([row(1, "99", "9"), row(2, "2", "3")], 2, pageNumber);
      },
      freeRecount: async (countryCode) => ({
        ok: true,
        total: countryCode === 643 ? 1 : 2,
        meta,
      }),
      stageFree: async (got) => {
        staged.push([...got]);
      },
      log: async () => undefined,
    });
    expect(result).toEqual({ ok: true, inserted: 2 });
    expect(staged[0]).toEqual([row(1, "10", "1")]);
    expect(staged[1]).toEqual([row(2, "2", "3")]);
  });

  it("does not publish when no country has prefix 7", async () => {
    let freeCalls = 0;
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [{ code: 1, prefix: 1 }],
        meta,
      }),
      freePage: async () => {
        freeCalls += 1;
        return free([], 0, 1);
      },
      freeRecount: async () => ({ ok: true, total: 0, meta }),
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(freeCalls).toBe(0);
  });

  it("publishes the stable free pass after the total moves", async () => {
    let pass = 0;
    let staged: FreeRow[] = [];
    const lines: string[] = [];
    const total = FREE_PAGE_LIMIT + 1;
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async (_country, pageNumber) => {
        if (pageNumber === 1) {
          pass += 1;
          return free(rows(pass * 100_000, FREE_PAGE_LIMIT), total, pageNumber);
        }
        if (pass === 1) return free([row(1)], total + 1, pageNumber);
        return free([row(pass * 100_000 + FREE_PAGE_LIMIT)], total, pageNumber);
      },
      freeRecount: async () => ({ ok: true, total, meta }),
      stageFree: async (got) => {
        staged = [...got];
      },
      log: async (text) => {
        lines.push(text);
      },
    });
    expect(result).toEqual({ ok: true, inserted: total });
    expect(staged).toHaveLength(total);
    expect(staged[0]?.e164).toBe(did(200_000));
    expect(staged.some((item) => item.e164 === did(100_000))).toBe(false);
    expect(staged.some((item) => item.e164 === did(1))).toBe(false);
    expect(lines).toContain("Попытка 1 из 5");
  });

  it("leaves the catalog after five free total moves", async () => {
    let pageTwo = 0;
    let staged = 0;
    const lines: string[] = [];
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async (_country, pageNumber) => {
        if (pageNumber === 1) {
          return free(rows(0, FREE_PAGE_LIMIT), FREE_PAGE_LIMIT + 1, pageNumber);
        }
        pageTwo += 1;
        return free([row(1)], FREE_PAGE_LIMIT + 2, pageNumber);
      },
      freeRecount: async () => ({ ok: true, total: FREE_PAGE_LIMIT + 1, meta }),
      stageFree: async () => {
        staged += 1;
      },
      log: async (text) => {
        lines.push(text);
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(TOTAL_MOVED);
    expect(pageTwo).toBe(5);
    expect(staged).toBe(0);
    expect(lines.filter((text) => text.startsWith("Попытка"))).toEqual([
      "Попытка 1 из 5",
      "Попытка 2 из 5",
      "Попытка 3 из 5",
      "Попытка 4 из 5",
      "Попытка 5 из 5",
    ]);
  });

  it("retries a repeated free number and publishes the next pass", async () => {
    let calls = 0;
    let staged: FreeRow[] = [];
    const lines: string[] = [];
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async (_country, pageNumber) => {
        calls += 1;
        if (calls === 1) return free([row(1), row(1)], 2, pageNumber);
        return free([row(3), row(4)], 2, pageNumber);
      },
      freeRecount: async () => ({ ok: true, total: 2, meta }),
      stageFree: async (got) => {
        staged = [...got];
      },
      log: async (text) => {
        lines.push(text);
      },
    });
    expect(result).toEqual({ ok: true, inserted: 2 });
    expect(calls).toBe(2);
    expect(staged).toEqual([row(3), row(4)]);
    expect(lines).toContain("Попытка 1 из 5");
  });

  it("stops after five repeated free numbers", async () => {
    let calls = 0;
    let staged = 0;
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async () => {
        calls += 1;
        return { ok: false, error: DUPLICATE_NUMBER, meta };
      },
      freeRecount: async () => ({ ok: true, total: 1, meta }),
      stageFree: async () => {
        staged += 1;
      },
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(DUPLICATE_NUMBER);
    expect(calls).toBe(5);
    expect(staged).toBe(0);
  });

  it("stops when a free page is shorter than requested", async () => {
    let calls = 0;
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async (_country, pageNumber) => {
        calls += 1;
        return free(rows(0, 25), 100, pageNumber);
      },
      freeRecount: async () => ({ ok: true, total: 100, meta }),
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(SHORT_LIST);
    expect(calls).toBe(2);
  });

  it("asks the same free page again after no answer", async () => {
    const pages: number[] = [];
    let missed = false;
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async (_country, pageNumber) => {
        pages.push(pageNumber);
        if (pageNumber === 2 && !missed) {
          missed = true;
          return { ok: false, error: "Площадка не ответила.", meta };
        }
        const count = pageNumber === 1 ? FREE_PAGE_LIMIT : 1;
        const body = pageNumber === 1 ? rows(0, count) : [row(FREE_PAGE_LIMIT)];
        return free(body, FREE_PAGE_LIMIT + 1, pageNumber);
      },
      freeRecount: async () => ({ ok: true, total: FREE_PAGE_LIMIT + 1, meta }),
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(pages).toEqual([1, 2, 2]);
  });

  it("does not repeat a rejected free page", async () => {
    let calls = 0;
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async () => {
        calls += 1;
        return { ok: false, error: "Площадка отклонила запрос.", meta };
      },
      freeRecount: async () => ({ ok: true, total: 1, meta }),
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it("asks the free recount again after no answer", async () => {
    let pages = 0;
    let recounts = 0;
    const result = await runMcnFreeWalk({
      beat,
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async (_country, pageNumber) => {
        pages += 1;
        return free([row(1)], 1, pageNumber);
      },
      freeRecount: async () => {
        recounts += 1;
        if (recounts === 1) return { ok: false, error: "Площадка не ответила.", meta };
        return { ok: true, total: 1, meta };
      },
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(pages).toBe(1);
    expect(recounts).toBe(2);
  });
});

describe("MCN Telecom access", () => {
  it("checks access with the probe page", async () => {
    let probes = 0;
    const result = await runAccessProbe({
      purchased: async () => purchased([], 0, 0),
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freeProbe: async (countryCode) => {
        probes += 1;
        expect(countryCode).toBe(643);
        return free([], 0, 1);
      },
    });
    expect(result.ok).toBe(true);
    expect(probes).toBe(1);
  });

  it("keeps each walk on its own requests", () => {
    const source = readFileSync(path.join(process.cwd(), "src/modules/mcn/walk.ts"), "utf8");
    const purchased = source.slice(
      source.indexOf("export async function runMcnPurchasedWalk"),
      source.indexOf("export async function runMcnFreeWalk"),
    );
    const free = source.slice(
      source.indexOf("export async function runMcnFreeWalk"),
      source.indexOf("export async function runAccessProbe"),
    );
    expect(purchased).toContain("composite-dids");
    expect(purchased).not.toContain("countries");
    expect(purchased).not.toContain("freePage");
    expect(free).toContain('method: "numbers"');
    expect(free).not.toContain("composite-dids");
    expect(free).not.toContain("purchasedPage");
  });
});
