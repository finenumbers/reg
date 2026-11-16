import { describe, expect, it } from "vitest";
import { DUPLICATE_NUMBER, type FreeRow } from "@/modules/mcn/parse";
import { FREE_PAGE_LIMIT } from "@/modules/mcn/url";
import {
  SHORT_LIST,
  TOTAL_MOVED,
  runAccessProbe,
  runMcnWalk,
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

describe("MCN Telecom walk", () => {
  it("stops before countries when the purchased page fails", async () => {
    let countries = 0;
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => ({
        ok: false,
        error: "Площадка отклонила запрос.",
        meta,
      }),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
      countries: async () => {
        countries += 1;
        return { ok: true, countries: [], meta };
      },
      freePage: async () => free([], 0, 1),
      freeRecount: async () => ({ ok: true, total: 0, meta }),
      stagePurchased: async () => undefined,
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(countries).toBe(0);
  });

  it("rejects a purchased offset that does not echo", async () => {
    let countries = 0;
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([did(1)], 1, 5),
      purchasedRecount: async () => ({ ok: true, total: 1, meta }),
      countries: async () => {
        countries += 1;
        return { ok: true, countries: [{ code: 643, prefix: 7 }], meta };
      },
      freePage: async () => free([], 0, 1),
      freeRecount: async () => ({ ok: true, total: 0, meta }),
      stagePurchased: async () => undefined,
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(countries).toBe(0);
  });

  it("advances a short purchased page and reads only prefix 7", async () => {
    const offsets: number[] = [];
    const countriesAsked: number[] = [];
    let staged: string[] = [];
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async (offset) => {
        offsets.push(offset);
        if (offset === 0) return purchased([did(1), did(2)], 3, 0);
        return purchased([did(3)], 3, offset);
      },
      purchasedRecount: async () => ({ ok: true, total: 3, meta }),
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
      stagePurchased: async (rows) => {
        staged = [...rows];
      },
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(offsets).toEqual([0, 2]);
    expect(staged).toEqual([did(1), did(2), did(3)]);
    expect(countriesAsked).toEqual([643]);
  });

  it("retries a short free page at the same page and keeps the full page", async () => {
    const pages: number[] = [];
    let staged: FreeRow[] = [];
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([], 0, 0),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
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
      stagePurchased: async () => undefined,
      stageFree: async (rows) => {
        staged = [...rows];
      },
      log: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(pages).toEqual([1, 1, 2]);
    expect(staged).toHaveLength(FREE_PAGE_LIMIT + 5);
    expect(staged[0]?.e164).toBe(did(100));
  });

  it("fails a country when the short page repeats", async () => {
    let staged = 0;
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([], 0, 0),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
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
      stagePurchased: async () => undefined,
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
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([], 0, 0),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
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
      stagePurchased: async () => undefined,
      stageFree: async (rows) => {
        staged.push([...rows]);
      },
      log: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(staged[0]).toEqual([row(1, "10", "1")]);
    expect(staged[1]).toEqual([row(2, "2", "3")]);
  });

  it("does not publish when no country has prefix 7", async () => {
    let freeCalls = 0;
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([did(1)], 1, 0),
      purchasedRecount: async () => ({ ok: true, total: 1, meta }),
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
      stagePurchased: async () => undefined,
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(freeCalls).toBe(0);
  });

  it("reads a moved total once more and stops on the second move", async () => {
    let pass = 0;
    let staged = 0;
    const once = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async (offset) => purchased([did(1)], 1, offset),
      purchasedRecount: async () => {
        pass += 1;
        return { ok: true, total: pass === 1 ? 2 : 1, meta };
      },
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async () => free([], 0, 1),
      freeRecount: async () => ({ ok: true, total: 0, meta }),
      stagePurchased: async () => {
        staged += 1;
      },
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(once.ok).toBe(true);
    expect(pass).toBe(2);
    expect(staged).toBe(1);

    const twice = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async (offset) => purchased([did(1)], 1, offset),
      purchasedRecount: async () => ({ ok: true, total: 2, meta }),
      countries: async () => ({ ok: true, countries: [], meta }),
      freePage: async () => free([], 0, 1),
      freeRecount: async () => ({ ok: true, total: 0, meta }),
      stagePurchased: async () => undefined,
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(twice.ok).toBe(false);
  });

  it("publishes the stable free pass after the total moves", async () => {
    let pass = 0;
    let staged: FreeRow[] = [];
    const lines: string[] = [];
    const total = FREE_PAGE_LIMIT + 1;
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([], 0, 0),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
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
      stagePurchased: async () => undefined,
      stageFree: async (got) => {
        staged = [...got];
      },
      log: async (text) => {
        lines.push(text);
      },
    });
    expect(result.ok).toBe(true);
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
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([], 0, 0),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
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
      stagePurchased: async () => undefined,
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
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([], 0, 0),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
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
      stagePurchased: async () => undefined,
      stageFree: async (got) => {
        staged = [...got];
      },
      log: async (text) => {
        lines.push(text);
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(staged).toEqual([row(3), row(4)]);
    expect(lines).toContain("Попытка 1 из 5");
  });

  it("stops after five repeated free numbers", async () => {
    let calls = 0;
    let staged = 0;
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([], 0, 0),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
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
      stagePurchased: async () => undefined,
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
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([], 0, 0),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
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
      stagePurchased: async () => undefined,
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(SHORT_LIST);
    expect(calls).toBe(2);
  });

  it("does not reread a country after a transport failure", async () => {
    let calls = 0;
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([], 0, 0),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
      countries: async () => ({
        ok: true,
        countries: [{ code: 643, prefix: 7 }],
        meta,
      }),
      freePage: async () => {
        calls += 1;
        return { ok: false, error: "Площадка не ответила.", meta };
      },
      freeRecount: async () => ({ ok: true, total: 1, meta }),
      stagePurchased: async () => undefined,
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it("stops when the free recount fails", async () => {
    let pages = 0;
    let recounts = 0;
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async () => purchased([], 0, 0),
      purchasedRecount: async () => ({ ok: true, total: 0, meta }),
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
        return { ok: false, error: "Площадка не ответила.", meta };
      },
      stagePurchased: async () => undefined,
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(pages).toBe(1);
    expect(recounts).toBe(1);
  });

  it("stops a purchased duplicate on the first page", async () => {
    let calls = 0;
    let countries = 0;
    const result = await runMcnWalk({
      beat: async () => "run" satisfies Gate,
      purchasedPage: async (offset) => {
        calls += 1;
        return purchased([did(1), did(1)], 2, offset);
      },
      purchasedRecount: async () => ({ ok: true, total: 2, meta }),
      countries: async () => {
        countries += 1;
        return { ok: true, countries: [], meta };
      },
      freePage: async () => free([], 0, 1),
      freeRecount: async () => ({ ok: true, total: 0, meta }),
      stagePurchased: async () => undefined,
      stageFree: async () => undefined,
      log: async () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(DUPLICATE_NUMBER);
    expect(calls).toBe(1);
    expect(countries).toBe(0);
  });

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
});
