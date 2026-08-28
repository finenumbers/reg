import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_BILLING_LABEL,
  MISSING_PSTN_LABEL,
} from "@/modules/enrich/types";

const findManyCdr = vi.fn();
const updateCdr = vi.fn();
const countCdr = vi.fn();
const loadDescriptions = vi.fn();
const enrichPstn = vi.fn();
const enrichGeo = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    cdrRecord: {
      findMany: (...args: unknown[]) => findManyCdr(...args),
      update: (...args: unknown[]) => updateCdr(...args),
      count: (...args: unknown[]) => countCdr(...args),
    },
  },
}));

vi.mock("@/modules/enrich/lookups", () => ({
  loadDescriptionsForPhones: (...args: unknown[]) => loadDescriptions(...args),
  enrichPstnPhones: (...args: unknown[]) => enrichPstn(...args),
  enrichGeoIps: (...args: unknown[]) => enrichGeo(...args),
}));

import {
  addCdrEnrichKeysFromFields,
  backfillUnenrichedCdrRecords,
  createCdrEnrichKeySets,
  enrichFieldsForRow,
  loadCdrImportEnrichment,
} from "@/modules/traffic/enrich-import";

const EMPTY_STATS = {
  pstnCacheHits: 0,
  pstnLiveLookups: 0,
  geoCacheHits: 0,
  geoLiveLookups: 0,
};

describe("addCdrEnrichKeysFromFields", () => {
  it("skips blank phones and strips ip:port", () => {
    const keys = createCdrEnrichKeySets();
    addCdrEnrichKeysFromFields(keys, {
      bill_ani: " 79501112233 ",
      bill_dnis: "",
      remote_src_sig_address: "46.20.69.189:5060",
      remote_dst_sig_address: "   ",
    });
    expect([...keys.phones]).toEqual(["79501112233"]);
    expect([...keys.ips]).toEqual(["46.20.69.189"]);
  });
});

describe("enrichFieldsForRow", () => {
  it("maps description, PSTN and GeoIP ISO like the enrich XLSX", () => {
    const fields = enrichFieldsForRow(
      "79501112233",
      "78620000000",
      "1.2.3.4:5060",
      "5.6.7.8:5060",
      {
        descriptions: new Map([["79501112233", "Офис А"]]),
        pstn: new Map([
          [
            "79501112233",
            { found: true, operator: "МТС", garTerritory: "г. Москва" },
          ],
        ]),
        geo: new Map([
          [
            "1.2.3.4",
            {
              country: "Россия",
              countryIso: "RU",
              city: "Москва",
              isp: "Ростелеком",
              datasetDate: "20260801",
            },
          ],
        ]),
      },
    );
    expect(fields.sideA).toBe("Офис А");
    expect(fields.sideB).toBe(MISSING_BILLING_LABEL);
    expect(fields.operatorA).toBe("МТС");
    expect(fields.geographyA).toBe("г. Москва");
    expect(fields.operatorB).toBe(MISSING_PSTN_LABEL);
    expect(fields.geographyB).toBe(MISSING_PSTN_LABEL);
    expect(fields.countryA).toBe("RU");
    expect(fields.cityA).toBe("Москва");
    expect(fields.providerA).toBe("Ростелеком");
    expect(fields.countryB).toBe("");
    expect(fields.cityB).toBe("");
    expect(fields.providerB).toBe("");
  });

  it("uses sentinels for empty numbers without looking up blank keys", () => {
    const fields = enrichFieldsForRow("", "", "", "", {
      descriptions: new Map([["", "should-not-use"]]),
      pstn: new Map(),
      geo: new Map(),
    });
    expect(fields.sideA).toBe(MISSING_BILLING_LABEL);
    expect(fields.sideB).toBe(MISSING_BILLING_LABEL);
    expect(fields.operatorA).toBe(MISSING_PSTN_LABEL);
    expect(fields.countryA).toBe("");
  });
});

describe("loadCdrImportEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads descriptions, PSTN and GeoIP in parallel", async () => {
    loadDescriptions.mockResolvedValue(new Map([["7950", "Desk"]]));
    enrichPstn.mockResolvedValue({
      byOriginal: new Map([
        ["7950", { found: true, operator: "МТС", garTerritory: "МСК" }],
      ]),
      cacheHits: 1,
      liveLookups: 0,
    });
    enrichGeo.mockResolvedValue({
      byIp: new Map([
        [
          "8.8.8.8",
          {
            country: "US",
            countryIso: "US",
            city: "Mountain View",
            isp: "Google",
            datasetDate: null,
          },
        ],
      ]),
      cacheHits: 1,
      liveLookups: 0,
    });

    const maps = await loadCdrImportEnrichment(["7950"], ["8.8.8.8"]);
    expect(maps.descriptions.get("7950")).toBe("Desk");
    expect(maps.pstn.get("7950")?.operator).toBe("МТС");
    expect(maps.geo.get("8.8.8.8")?.countryIso).toBe("US");
    expect(maps.stats).toEqual({
      pstnCacheHits: 1,
      pstnLiveLookups: 0,
      geoCacheHits: 1,
      geoLiveLookups: 0,
    });
    expect(loadDescriptions).toHaveBeenCalledWith(["7950"]);
    expect(enrichPstn).toHaveBeenCalledWith(["7950"]);
    expect(enrichGeo).toHaveBeenCalledWith(["8.8.8.8"]);
  });
});

describe("backfillUnenrichedCdrRecords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadDescriptions.mockResolvedValue(new Map());
    enrichPstn.mockResolvedValue({
      byOriginal: new Map(),
      cacheHits: 0,
      liveLookups: 0,
    });
    enrichGeo.mockResolvedValue({
      byIp: new Map(),
      cacheHits: 0,
      liveLookups: 0,
    });
    updateCdr.mockResolvedValue({});
  });

  it("does not call lookups when the tail is empty", async () => {
    findManyCdr.mockResolvedValue([]);
    countCdr.mockResolvedValue(0);

    const result = await backfillUnenrichedCdrRecords({ maxRows: 2000 });

    expect(result).toEqual({
      backfilled: 0,
      remaining: 0,
      aborted: false,
      stats: EMPTY_STATS,
    });
    expect(loadDescriptions).not.toHaveBeenCalled();
    expect(enrichPstn).not.toHaveBeenCalled();
    expect(updateCdr).not.toHaveBeenCalled();
  });

  it("updates enrich fields and enrichedAt for a page", async () => {
    findManyCdr.mockResolvedValue([
      {
        id: "row_1",
        billAni: "79501112233",
        billDnis: "78620000000",
        remoteSrcSigAddress: "1.2.3.4:5060",
        remoteDstSigAddress: "",
      },
    ]);
    countCdr.mockResolvedValue(0);
    loadDescriptions.mockResolvedValue(new Map([["79501112233", "Офис"]]));

    const result = await backfillUnenrichedCdrRecords({ maxRows: 400 });

    expect(result.backfilled).toBe(1);
    expect(result.remaining).toBe(0);
    expect(updateCdr).toHaveBeenCalledWith({
      where: { id: "row_1" },
      data: expect.objectContaining({
        sideA: "Офис",
        sideB: MISSING_BILLING_LABEL,
        operatorA: MISSING_PSTN_LABEL,
        countryA: "",
        enrichedAt: expect.any(Date),
      }),
    });
  });

  it("stops before the next page when shouldAbort is true", async () => {
    findManyCdr.mockResolvedValue([]);
    countCdr.mockResolvedValue(12);

    const result = await backfillUnenrichedCdrRecords({
      maxRows: 2000,
      shouldAbort: () => true,
    });

    expect(result.aborted).toBe(true);
    expect(result.backfilled).toBe(0);
    expect(result.remaining).toBe(12);
    expect(findManyCdr).not.toHaveBeenCalled();
    expect(loadDescriptions).not.toHaveBeenCalled();
  });
});
