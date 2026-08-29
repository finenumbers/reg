import { beforeEach, describe, expect, it, vi } from "vitest";
import { rowEnrichmentComplete } from "@/modules/traffic/enrich-import";

const lookupPstnPhone = vi.fn();
const upsertPstnCache = vi.fn();
const loadPstnCacheByPhones = vi.fn();
const loadPstnCredentials = vi.fn();

vi.mock("@/lib/db", () => ({ prisma: {} }));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/modules/pstn/client", () => ({
  lookupPstnPhone: (...args: unknown[]) => lookupPstnPhone(...args),
  PstnLookupError: class PstnLookupError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = "PstnLookupError";
    }
  },
}));

vi.mock("@/modules/pstn/credentials", () => ({
  loadPstnCredentials: (...args: unknown[]) => loadPstnCredentials(...args),
}));

vi.mock("@/modules/pstn/cache", () => ({
  pruneStalePstnCache: vi.fn().mockResolvedValue(undefined),
  loadPstnCacheByPhones: (...args: unknown[]) => loadPstnCacheByPhones(...args),
  staleOrMissingPstnPhones: (phones: string[]) => phones,
  upsertPstnCache: (...args: unknown[]) => upsertPstnCache(...args),
}));

import { enrichPstnPhones } from "@/modules/enrich/lookups";

describe("enrichPstnPhones live errors", () => {
  beforeEach(() => {
    lookupPstnPhone.mockReset();
    upsertPstnCache.mockReset();
    loadPstnCacheByPhones.mockReset();
    loadPstnCredentials.mockReset();
    loadPstnCacheByPhones.mockResolvedValue(new Map());
    loadPstnCredentials.mockResolvedValue({
      baseUrl: "http://pstn.test",
      apiKey: "k",
    });
  });

  it("does not record a live failure as not-found", async () => {
    lookupPstnPhone.mockRejectedValue(new Error("PSTN down"));
    const result = await enrichPstnPhones(["79001112233"]);
    expect(result.byOriginal.has("79001112233")).toBe(false);
    expect(upsertPstnCache).not.toHaveBeenCalled();
    expect(
      rowEnrichmentComplete("79001112233", "", "", "", {
        pstn: result.byOriginal,
        geo: new Map(),
      }),
    ).toBe(false);
  });

  it("still records a successful live lookup", async () => {
    lookupPstnPhone.mockResolvedValue({
      found: true,
      operator: "МТС",
      garTerritory: "г. Москва",
    });
    const result = await enrichPstnPhones(["79001112233"]);
    expect(result.byOriginal.get("79001112233")).toEqual({
      found: true,
      operator: "МТС",
      garTerritory: "г. Москва",
    });
    expect(upsertPstnCache).toHaveBeenCalled();
    expect(
      rowEnrichmentComplete("79001112233", "", "", "", {
        pstn: result.byOriginal,
        geo: new Map(),
      }),
    ).toBe(true);
  });
});
