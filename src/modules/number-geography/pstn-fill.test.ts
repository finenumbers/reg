import { beforeEach, describe, expect, it, vi } from "vitest";
import { PstnLookupError } from "@/modules/pstn/client";
import type { PstnCredentials, PstnFields } from "@/modules/pstn/types";
import { parsePstnFillIds } from "@/modules/number-geography/pstn-fill-contract";
import {
  PSTN_FILL_FAILURE_COOLDOWN_MS,
  fillNumberGeographyPstn,
  resetPstnFillForTests,
  type PstnFillDeps,
} from "@/modules/number-geography/pstn-fill";

const creds: PstnCredentials = {
  baseUrl: "https://pstn.finenumbers.com",
  apiKey: "secret",
};

const found: PstnFields = {
  found: true,
  operator: "ПАО \"ВЫМПЕЛКОМ\"",
  garTerritory: "Новосибирская область",
};

const missing: PstnFields = {
  found: false,
  operator: null,
  garTerritory: null,
};

function deps(over: Partial<PstnFillDeps> = {}): PstnFillDeps {
  return {
    loadCredentials: async () => creds,
    loadEndpoints: async () => [{ id: "a", number: "79001112233" }],
    loadCache: async () => new Map(),
    lookup: async () => found,
    upsert: async () => {},
    loadLabels: async (ids) =>
      ids.map((id) => ({
        id,
        operator: found.operator ?? "",
        geography: found.garTerritory ?? "",
      })),
    ...over,
  };
}

describe("parsePstnFillIds", () => {
  it("rejects a batch larger than 16 and a non-array", () => {
    expect(parsePstnFillIds({ ids: Array.from({ length: 17 }, (_, i) => String(i)) }).ok).toBe(
      false,
    );
    expect(parsePstnFillIds({ ids: "79001112233" }).ok).toBe(false);
    expect(parsePstnFillIds({ ids: [""] }).ok).toBe(false);
    expect(parsePstnFillIds({ ids: ["x".repeat(65)] }).ok).toBe(false);
  });

  it("keeps the first copy of a repeated id", () => {
    expect(parsePstnFillIds({ ids: ["a", "a", "b"] })).toEqual({
      ok: true,
      ids: ["a", "b"],
    });
  });
});

describe("fillNumberGeographyPstn", () => {
  beforeEach(() => {
    resetPstnFillForTests({ concurrency: 1 });
  });

  it("writes a cache miss and does not call PSTN when credentials are missing", async () => {
    const lookup = vi.fn(async () => found);
    const upsert = vi.fn(async () => {});
    const hit = await fillNumberGeographyPstn(["a"], deps({ lookup, upsert }));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("9001112233", creds);
    expect(upsert).toHaveBeenCalledWith("9001112233", found);
    expect(hit).toEqual({
      configured: true,
      items: [
        {
          id: "a",
          status: "filled",
          operator: found.operator,
          geography: found.garTerritory,
        },
      ],
    });

    const loadEndpoints = vi.fn(async () => []);
    const skipped = await fillNumberGeographyPstn(
      ["a"],
      deps({ loadCredentials: async () => null, loadEndpoints, lookup }),
    );
    expect(skipped).toEqual({ configured: false });
    expect(loadEndpoints).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("does not look up a stored row, including a stale miss", async () => {
    const lookup = vi.fn(async () => found);
    const stale = new Map([
      [
        "9001112233",
        {
          found: false,
          operator: null,
          garTerritory: null,
          lookedUpAt: new Date(0),
        },
      ],
    ]);
    const result = await fillNumberGeographyPstn(
      ["a"],
      deps({
        lookup,
        loadCache: async () => stale,
        loadLabels: async () => [
          { id: "a", operator: "Нет в реестре МинЦифры", geography: "Нет в реестре МинЦифры" },
        ],
      }),
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(result).toEqual({
      configured: true,
      items: [
        {
          id: "a",
          status: "cached",
          operator: "Нет в реестре МинЦифры",
          geography: "Нет в реестре МинЦифры",
        },
      ],
    });
  });

  it("stores a negative PSTN answer", async () => {
    const upsert = vi.fn(async () => {});
    await fillNumberGeographyPstn(
      ["a"],
      deps({
        lookup: async () => missing,
        upsert,
        loadLabels: async () => [
          { id: "a", operator: "Нет в реестре МинЦифры", geography: "Нет в реестре МинЦифры" },
        ],
      }),
    );
    expect(upsert).toHaveBeenCalledWith("9001112233", missing);
  });

  it("does not store a transport error and stays quiet for five minutes", async () => {
    let now = Date.parse("2026-10-31T00:00:00Z");
    resetPstnFillForTests({ concurrency: 1, now: () => new Date(now) });
    const lookup = vi.fn(async (): Promise<PstnFields> => {
      throw new PstnLookupError("NETWORK", "down");
    });
    const upsert = vi.fn(async () => {});
    const first = await fillNumberGeographyPstn(["a"], deps({ lookup, upsert }));
    if (!first.configured) throw new Error("expected PSTN to be configured");
    expect(first.items[0]?.status).toBe("error");
    expect(upsert).not.toHaveBeenCalled();

    lookup.mockClear();
    await fillNumberGeographyPstn(["a"], deps({ lookup, upsert }));
    expect(lookup).not.toHaveBeenCalled();

    now += PSTN_FILL_FAILURE_COOLDOWN_MS + 1;
    lookup.mockResolvedValue(found);
    await fillNumberGeographyPstn(["a"], deps({ lookup, upsert }));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("stops later lookups after one unauthorized response", async () => {
    const lookup = vi.fn(async (phone: string) => {
      if (phone === "9000000001") {
        throw new PstnLookupError("UNAUTHORIZED", "bad key", 401);
      }
      return found;
    });
    const result = await fillNumberGeographyPstn(
      ["a", "b"],
      deps({
        lookup,
        loadEndpoints: async () => [
          { id: "a", number: "79000000001" },
          { id: "b", number: "79000000002" },
        ],
      }),
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("9000000001", creds);
    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.items.map((item) => item.status)).toEqual(["error", "error"]);
    }

    lookup.mockClear();
    await fillNumberGeographyPstn(
      ["b"],
      deps({
        lookup,
        loadEndpoints: async () => [{ id: "b", number: "79000000002" }],
      }),
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it("opens the network stop after three timeouts", async () => {
    const lookup = vi.fn(async () => {
      throw new PstnLookupError("TIMEOUT", "slow");
    });
    await fillNumberGeographyPstn(
      ["a", "b", "c", "d"],
      deps({
        lookup,
        loadEndpoints: async () => [
          { id: "a", number: "79000000001" },
          { id: "b", number: "79000000002" },
          { id: "c", number: "79000000003" },
          { id: "d", number: "79000000004" },
        ],
      }),
    );
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("keeps the network pause when a lookup already in flight then succeeds", async () => {
    resetPstnFillForTests({ concurrency: 4 });
    let failures = 0;
    let releaseSuccess: () => void = () => {};
    const successGate = new Promise<void>((resolve) => {
      releaseSuccess = resolve;
    });
    const lookup = vi.fn(async (phone: string) => {
      if (phone === "9000000004") {
        await successGate;
        return found;
      }
      failures += 1;
      throw new PstnLookupError("TIMEOUT", "slow");
    });
    const pending = fillNumberGeographyPstn(
      ["a", "b", "c", "d", "e"],
      deps({
        lookup,
        loadEndpoints: async () => [
          { id: "a", number: "79000000001" },
          { id: "b", number: "79000000002" },
          { id: "c", number: "79000000003" },
          { id: "d", number: "79000000004" },
          { id: "e", number: "79000000005" },
        ],
        loadLabels: async (ids) =>
          ids.map((id) => ({
            id,
            operator: found.operator ?? "",
            geography: found.garTerritory ?? "",
          })),
      }),
    );
    await vi.waitFor(() => expect(failures).toBe(3));
    releaseSuccess();
    await pending;
    expect(lookup).toHaveBeenCalledTimes(4);
    expect(lookup).not.toHaveBeenCalledWith("9000000005", creds);
  });

  it("lets a success clear the timeout streak", async () => {
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(new PstnLookupError("TIMEOUT", "slow"))
      .mockRejectedValueOnce(new PstnLookupError("NETWORK", "down"))
      .mockResolvedValueOnce(found)
      .mockResolvedValueOnce(found);
    await fillNumberGeographyPstn(
      ["a", "b", "c", "d"],
      deps({
        lookup,
        loadEndpoints: async () => [
          { id: "a", number: "79000000001" },
          { id: "b", number: "79000000002" },
          { id: "c", number: "79000000003" },
          { id: "d", number: "79000000004" },
        ],
        loadLabels: async (ids) =>
          ids.map((id) => ({
            id,
            operator: found.operator ?? "",
            geography: found.garTerritory ?? "",
          })),
      }),
    );
    expect(lookup).toHaveBeenCalledTimes(4);
  });

  it("looks up one shared key once for two parallel calls and two ids", async () => {
    let resolveLookup: (fields: PstnFields) => void = () => {};
    const gate = new Promise<PstnFields>((resolve) => {
      resolveLookup = resolve;
    });
    const lookup = vi.fn(() => gate);
    const upsert = vi.fn(async () => {});
    const shared = deps({
      lookup,
      upsert,
      loadEndpoints: async (ids) =>
        ids.map((id) => ({
          id,
          number: id === "b" ? "8 (900) 111-22-33" : "79001112233",
        })),
      loadLabels: async (ids) =>
        ids.map((id) => ({
          id,
          operator: "МТС",
          geography: "край",
        })),
    });

    const first = fillNumberGeographyPstn(["a"], shared);
    const second = fillNumberGeographyPstn(["a", "b"], shared);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lookup).toHaveBeenCalledTimes(1);
    resolveLookup(found);
    const [left, right] = await Promise.all([first, second]);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(left.configured && left.items[0]?.status).toBe("filled");
    expect(right.configured && right.items.map((item) => item.operator)).toEqual([
      "МТС",
      "МТС",
    ]);
  });

  it("does not call PSTN for an unknown id or a number that is not 10 digits", async () => {
    const lookup = vi.fn(async () => found);
    const result = await fillNumberGeographyPstn(
      ["missing", "short"],
      deps({
        lookup,
        loadEndpoints: async () => [{ id: "short", number: "123" }],
      }),
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(result).toEqual({
      configured: true,
      items: [
        { id: "missing", status: "invalid" },
        { id: "short", status: "invalid" },
      ],
    });
  });

  it("treats a long Retry-After as a failure without waiting it out", async () => {
    const sleep = vi.fn(async () => {});
    resetPstnFillForTests({ concurrency: 1, sleep });
    const lookup = vi.fn(async () => {
      throw new PstnLookupError("RATE_LIMITED", "busy", 429, 30);
    });
    const upsert = vi.fn(async () => {});
    const result = await fillNumberGeographyPstn(["a"], deps({ lookup, upsert }));
    expect(sleep).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
    expect(result.configured && result.items[0]?.status).toBe("error");
  });

  it("retries a short rate limit once", async () => {
    const sleep = vi.fn(async () => {});
    resetPstnFillForTests({ concurrency: 1, sleep });
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(new PstnLookupError("RATE_LIMITED", "busy", 429, 1))
      .mockResolvedValueOnce(found);
    const upsert = vi.fn(async () => {});
    const result = await fillNumberGeographyPstn(["a"], deps({ lookup, upsert }));
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(result.configured && result.items[0]?.status).toBe("filled");
  });
});
