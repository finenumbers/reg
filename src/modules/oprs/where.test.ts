import { describe, expect, it } from "vitest";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import { CALL_CATEGORY } from "@/modules/traffic/call-class";
import { MOBILE_RF_DIRECTION } from "@/modules/rtu/columns";
import { PARKING_DST } from "@/modules/stats/classify";
import {
  buildOprsWhere,
  oprsKeysetWhere,
  oprsPredicate,
  OprsQueryError,
  resolveOprsSnapshot,
} from "@/modules/oprs/where";

const NOW = new Date("2026-11-13T07:00:00.000Z");

describe("oprs predicate", () => {
  it("keeps outgoing mobile RF and drops only exact Service_Parking", () => {
    expect(oprsPredicate()).toEqual({
      callCategory: CALL_CATEGORY.outgoing,
      tariffDirection: MOBILE_RF_DIRECTION,
      dstName: { not: PARKING_DST },
      operatorB: { not: MISSING_PSTN_LABEL },
    });
    expect(PARKING_DST).toBe("Service_Parking");
    expect(MOBILE_RF_DIRECTION).toBe("Мобильные РФ");
  });
});

describe("oprs keyset", () => {
  const cursor = { cdrDate: "2026-11-01 10:00:00", cdrId: "cdr-2" };

  it("walks older rows when the list is descending", () => {
    expect(oprsKeysetWhere(null, cursor)).toEqual({
      OR: [
        { cdrDate: { lt: cursor.cdrDate } },
        { AND: [{ cdrDate: cursor.cdrDate }, { cdrId: { lt: cursor.cdrId } }] },
      ],
    });
    expect(oprsKeysetWhere("desc", cursor)).toEqual(oprsKeysetWhere(null, cursor));
  });

  it("walks newer rows when the list is ascending", () => {
    expect(oprsKeysetWhere("asc", cursor)).toEqual({
      OR: [
        { cdrDate: { gt: cursor.cdrDate } },
        { AND: [{ cdrDate: cursor.cdrDate }, { cdrId: { gt: cursor.cdrId } }] },
      ],
    });
  });
});

describe("oprs snapshot", () => {
  it("clamps a future stamp and refuses a blank one", () => {
    expect(resolveOprsSnapshot("2026-11-13T06:00:00.000Z", NOW).toISOString()).toBe(
      "2026-11-13T06:00:00.000Z",
    );
    expect(resolveOprsSnapshot("2099-01-01T00:00:00.000Z", NOW)).toEqual(NOW);
    expect(() => resolveOprsSnapshot("   ", NOW)).toThrow(OprsQueryError);
    expect(() => resolveOprsSnapshot("not-a-date", NOW)).toThrow(OprsQueryError);
  });
});

describe("oprs where", () => {
  const snapshot = new Date("2026-11-13T06:00:00.000Z");

  it("keeps the fixed predicate beside a column filter", () => {
    const where = buildOprsWhere({
      year: 2026,
      month: 11,
      filters: {
        dst_name: ["Service_Parking_1"],
        geography_b: ["Москва"],
        oprs_network: ["МТС"],
        call_category: ["Входящий"],
      },
      phoneQ: "",
      flags: {},
      snapshot,
      cursor: null,
      timeSort: null,
    });
    expect(where.AND).toEqual(
      expect.arrayContaining([oprsPredicate(), { importedAt: { lte: snapshot } }]),
    );
    const text = JSON.stringify(where);
    expect(text).toContain("Service_Parking_1");
    expect(text).not.toContain("Входящий");
    expect(text).not.toContain("Москва");
    expect(text).toContain(MISSING_PSTN_LABEL);
    expect(text).not.toContain("МТС");
    expect(text).not.toContain("skip");
  });

  it("adds the keyset only when a cursor is present", () => {
    const cursor = { cdrDate: "2026-11-02 00:00:00", cdrId: "z" };
    const where = buildOprsWhere({
      year: 2026,
      month: 11,
      filters: {},
      phoneQ: "900",
      flags: { failed: true },
      snapshot,
      cursor,
      timeSort: null,
    });
    expect(where.AND).toEqual(
      expect.arrayContaining([oprsPredicate(), oprsKeysetWhere(null, cursor)]),
    );
  });
});
