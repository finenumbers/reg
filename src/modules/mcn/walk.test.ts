import { describe, expect, it } from "vitest";
import type { FreeRow } from "@/modules/mcn/parse";
import { runMcnWalk, type Gate } from "@/modules/mcn/walk";

const meta = { status: 200, attempts: 1, durationMs: 1 };

function did(index: number): string {
  return `7495${String(index).padStart(7, "0")}`;
}

function row(index: number, purchase = "10", period = "1"): FreeRow {
  return { e164: did(index), incomingPurchase: purchase, incomingPeriod: period };
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
        if (pages.length === 1)
          return free(
            Array.from({ length: 10 }, (_, i) => row(i)),
            30,
            pageNumber,
          );
        if (pageNumber === 1) {
          return free(
            Array.from({ length: 25 }, (_, i) => row(i + 100)),
            30,
            pageNumber,
          );
        }
        return free(
          Array.from({ length: 5 }, (_, i) => row(i + 200)),
          30,
          pageNumber,
        );
      },
      freeRecount: async () => ({ ok: true, total: 30, meta }),
      stagePurchased: async () => undefined,
      stageFree: async (rows) => {
        staged = [...rows];
      },
      log: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(pages).toEqual([1, 1, 2]);
    expect(staged).toHaveLength(30);
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
});
