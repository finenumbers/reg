import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { RESPLIT_LOCKS } from "@/modules/numbering-sync/recompute";
import {
  acceptShowcasePage,
  freePrices,
  nationalDigits,
  parseAccessToken,
  parseManagementPage,
  parseRegionCodes,
  parseSession,
  parseShowcasePage,
  rejectForeignCode,
  showcasePageIsFull,
} from "@/modules/runexis/parse";
import { RECLAIM_STAGE_SQL, RECLAIM_STATE_SQL } from "@/modules/runexis/reclaim";
import { sanitizeLogLine } from "@/modules/runexis/log";
import {
  DELETE_RUNEXIS_FREE_SQL,
  DELETE_RUNEXIS_PURCHASED_SQL,
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  decidePublish,
  dropOverlapSql,
  fillSplitSql,
  stageFreeSql,
} from "@/modules/runexis/sql";
import {
  catalogUrl,
  codesUrl,
  loginUrl,
  refreshUrl,
  showcaseSliceUrl,
} from "@/modules/runexis/url";

function flattenSql(sql: Prisma.Sql): string {
  const text: string[] = [];
  const strings = sql.strings;
  const values = sql.values;
  for (let i = 0; i < strings.length; i++) {
    text.push(strings[i] ?? "");
    if (i >= values.length) continue;
    const value = values[i];
    text.push(value instanceof Prisma.Sql ? flattenSql(value) : "?");
  }
  return text.join("");
}

describe("runexis showcase", () => {
  it("asks for one flat code and does not send the city", () => {
    expect(loginUrl()).toBe("https://didapi.runexis.ru/api/v1/login");
    expect(codesUrl()).toBe("https://didapi.runexis.ru/api/v1/regions/codes");
    expect(showcaseSliceUrl(0, { code: "901", cityId: null })).toBeNull();
    expect(showcaseSliceUrl(1, { code: "90", cityId: null })).toBeNull();
    expect(showcaseSliceUrl(1, { code: "901", cityId: 1.5 })).toBeNull();
    const def = new URL(showcaseSliceUrl(2, { code: "901", cityId: null }) ?? "");
    expect(def.origin).toBe("https://didapi.runexis.ru");
    expect(def.pathname).toBe("/api/v1/numbers/showcase");
    expect([...def.searchParams.keys()].sort()).toEqual([
      "limit",
      "page",
      "region_codes[0]",
    ]);
    expect(def.searchParams.get("page")).toBe("2");
    expect(def.searchParams.get("limit")).toBe("1000");
    expect(def.searchParams.get("region_codes[0]")).toBe("901");
    expect(def.searchParams.has("region_codes[0][0]")).toBe(false);
    expect(def.searchParams.has("region_codes[]")).toBe(false);
    expect(def.searchParams.has("city_ids[]")).toBe(false);
    expect(def.searchParams.has("city_ids[0]")).toBe(false);
    expect(def.searchParams.has("class_id")).toBe(false);
    expect(def.searchParams.has("phone_number")).toBe(false);
    expect(def.searchParams.has("number_status_id")).toBe(false);
    const abc = new URL(showcaseSliceUrl(1, { code: "495", cityId: 58 }) ?? "");
    expect([...abc.searchParams.keys()].sort()).toEqual([
      "limit",
      "page",
      "region_codes[0]",
    ]);
    expect(abc.searchParams.get("region_codes[0]")).toBe("495");
    expect(abc.searchParams.has("region_codes[0][0]")).toBe(false);
    expect(abc.searchParams.has("region_codes[]")).toBe(false);
    expect(abc.searchParams.has("city_ids[]")).toBe(false);
    expect(abc.searchParams.has("city_ids[0]")).toBe(false);
    expect(rejectForeignCode([{ e164: "79010000001" }], "901")).toBeNull();
    expect(rejectForeignCode([], "901")).toBeNull();
    expect(rejectForeignCode([{ e164: "74953084480" }], "901")).toContain("другого кода");
    const directory = parseRegionCodes({
      success: true,
      data: [
        { city_id: 58, city_name: "Москва", codes: ["495", "499"] },
        { city_id: null, codes: ["901", "901"] },
        { city_id: 79, codes: [848] },
      ],
    });
    expect(directory.ok).toBe(true);
    if (!directory.ok) return;
    expect(directory.slices).toEqual([
      { code: "495", cityId: 58 },
      { code: "499", cityId: 58 },
      { code: "901", cityId: null },
      { code: "848", cityId: 79 },
    ]);
    expect(parseRegionCodes({ success: true, data: [] }).ok).toBe(false);
    expect(
      parseRegionCodes({ success: true, data: [{ city_id: null, codes: ["9"] }] }).ok,
    ).toBe(false);
    expect(
      parseRegionCodes({ success: true, data: [{ city_id: "58", codes: ["495"] }] }).ok,
    ).toBe(false);
  });

  it("stores an eleven-digit number and leaves a bad price empty", () => {
    expect(nationalDigits("901", "1234567")).toBe("79011234567");
    expect(nationalDigits(901, 1234567)).toBe("79011234567");
    expect(nationalDigits("495", "74953084480")).toBe("74953084480");
    expect(nationalDigits("090", "1234567")).toBe("70901234567");
    const page = parseShowcasePage({
      success: true,
      data: [
        { code: 901, number: "1234567", mera_price: 1000 },
        {
          code: "495",
          number: "3084480",
          installation_cost: "12.50",
          subscription_fee: 9,
        },
        { code: "495", number: "3084481", installationCost: "нет", mera_price: 4 },
      ],
      meta: { total: 3, page: 1, limit: 1000 },
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.page.rows).toEqual([
      { e164: "79011234567", incomingPurchase: "1000", incomingPeriod: "" },
      { e164: "74953084480", incomingPurchase: "12.50", incomingPeriod: "9" },
      { e164: "74953084481", incomingPurchase: "", incomingPeriod: "" },
    ]);
    expect(freePrices({ mera_price: 1, subscriptionFee: 2 })).toEqual({
      incomingPurchase: "1",
      incomingPeriod: "2",
    });
    const bought = parseManagementPage({
      success: true,
      data: [
        { code: 901, number: "1234567", status: { mnemonic: "allocated" } },
        { code: "495", number: "3084480", status: { mnemonic: " Free " } },
      ],
      meta: { total: 2, page: 1, limit: 30 },
    });
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.page.rows).toEqual(["79011234567"]);
    expect(bought.page.skippedFree).toBe(1);
    expect(bought.page.read).toBe(2);
    expect(
      parseShowcasePage({
        success: true,
        data: [
          { code: "901", number: "0000001" },
          { code: "901", number: "0000001" },
        ],
        meta: { total: 2, page: 1, limit: 1000 },
      }).ok,
    ).toBe(false);
    expect(
      parseManagementPage({
        success: true,
        data: [{ code: "901", number: "1234567", status: {} }],
        meta: { total: 1, page: 1, limit: 30 },
      }).ok,
    ).toBe(false);
    expect(
      parseSession({ success: true, data: { token: "abc", refresh_token: "def" } }),
    ).toEqual({
      token: "abc",
      refreshToken: "def",
    });
  });

  it("accepts a short page only when the count lands on the total", () => {
    expect(acceptShowcasePage({ total: 0, got: 0, acceptedBefore: 0, limit: 30 })).toBe(
      "done",
    );
    expect(acceptShowcasePage({ total: 31, got: 1, acceptedBefore: 30, limit: 30 })).toBe(
      "done",
    );
    expect(acceptShowcasePage({ total: 40, got: 10, acceptedBefore: 0, limit: 30 })).toBe(
      "short",
    );
    expect(acceptShowcasePage({ total: 10, got: 30, acceptedBefore: 0, limit: 30 })).toBe(
      "over",
    );
    expect(acceptShowcasePage({ total: 60, got: 30, acceptedBefore: 0, limit: 30 })).toBe(
      "next",
    );
    expect(
      acceptShowcasePage({ total: 2000, got: 1000, acceptedBefore: 0, limit: 1000 }),
    ).toBe("next");
    expect(
      acceptShowcasePage({ total: 1001, got: 1, acceptedBefore: 1000, limit: 1000 }),
    ).toBe("done");
    expect(
      acceptShowcasePage({ total: 40, got: 30, acceptedBefore: 0, limit: 1000 }),
    ).toBe("short");
    const wrongLimit = parseShowcasePage({
      success: true,
      data: [{ code: "901", number: "0000001" }],
      meta: { total: 1, page: 1, limit: 30 },
    });
    expect(wrongLimit.ok).toBe(false);
    if (!wrongLimit.ok) expect(wrongLimit.error).toContain("другой размер");
    expect(showcasePageIsFull(0, 0)).toBe(true);
    expect(showcasePageIsFull(1107, 1000)).toBe(true);
    expect(showcasePageIsFull(5, 5)).toBe(true);
    expect(showcasePageIsFull(1107, 30)).toBe(false);
    expect(showcasePageIsFull(5, 4)).toBe(false);
    expect(showcasePageIsFull(0, 1)).toBe(false);
    expect(parseAccessToken({ success: true, data: { token: "abc def" } })).toBeNull();
    expect(parseAccessToken({ success: true, data: { token: "abc" } })).toBe("abc");
  });

  it("replaces Runexis rows in both catalogs", () => {
    expect(catalogUrl("management", 2)).toContain("/api/v1/numbers/management");
    expect(catalogUrl("management", 2)).toContain("limit=30");
    expect(refreshUrl()).toBe("https://didapi.runexis.ru/api/v1/refresh");
    expect(DELETE_RUNEXIS_FREE_SQL).toBe(
      "DELETE FROM free_numbers WHERE provider = 'Runexis'",
    );
    expect(DELETE_RUNEXIS_PURCHASED_SQL).toBe(
      "DELETE FROM purchased_numbers WHERE provider = 'Runexis'",
    );
    expect(FREE_COPY_SQL).toContain("incoming_purchase");
    expect(FREE_COPY_SQL).toContain("incoming_period");
    expect(FREE_COPY_SQL).not.toContain("DELETE");
    expect(FREE_COPY_SQL).not.toContain("rtu_mask_lookup");
    expect(PURCHASED_COPY_SQL).toContain("INSERT INTO purchased_numbers");
    expect(PURCHASED_COPY_SQL).not.toContain("mask_price");
    expect(PURCHASED_COPY_SQL).not.toContain("incoming");
    expect(PURCHASED_COPY_SQL).not.toContain("rtu_mask_lookup");
    expect(
      flattenSql(
        stageFreeSql("run", [
          { e164: "79011234567", incomingPurchase: "1", incomingPeriod: "" },
        ]),
      ),
    ).toContain("ON CONFLICT (run_id, catalog, e164) DO NOTHING");
    expect(flattenSql(dropOverlapSql("run"))).toContain("purchased");
    expect(flattenSql(fillSplitSql("run", 2000))).toContain(
      "stage.catalog = computed.catalog",
    );
    expect(
      decidePublish({
        held: true,
        stagedFree: 0,
        insertedFree: 0,
        stagedPurchased: 0,
        insertedPurchased: 0,
      }),
    ).toBe("commit");
    expect(
      decidePublish({
        held: true,
        stagedFree: 2,
        insertedFree: 1,
        stagedPurchased: 1,
        insertedPurchased: 1,
      }),
    ).toBe("rollback");
    expect(
      decidePublish({
        held: false,
        stagedFree: 1,
        insertedFree: 1,
        stagedPurchased: 1,
        insertedPurchased: 1,
      }),
    ).toBe("rollback");
  });

  it("drops the Runexis lease without touching catalogs", () => {
    const text = `${RECLAIM_STATE_SQL}\n${RECLAIM_STAGE_SQL}`;
    expect(text).not.toContain("free_numbers");
    expect(text).not.toContain("purchased_numbers");
    expect(text).toContain("runexis_sync_state");
    expect(text).toContain("DELETE FROM runexis_sync_stage");
  });

  it("locks SipOut before Runexis, UIS, Aurora Telecom, MTS Exolve, Voximplant, and MCN Telecom", () => {
    expect(RESPLIT_LOCKS).toHaveLength(7);
    expect(RESPLIT_LOCKS[0]).toContain("numbering_sync_state");
    expect(RESPLIT_LOCKS[0]).not.toContain("runexis_sync_state");
    expect(RESPLIT_LOCKS[1]).toContain("runexis_sync_state");
    expect(RESPLIT_LOCKS[1]).not.toContain("uis_sync_state");
    expect(RESPLIT_LOCKS[2]).toContain("uis_sync_state");
    expect(RESPLIT_LOCKS[2]).not.toContain("aurora_sync_state");
    expect(RESPLIT_LOCKS[3]).toContain("aurora_sync_state");
    expect(RESPLIT_LOCKS[3]).not.toContain("exolve_sync_state");
    expect(RESPLIT_LOCKS[4]).toContain("exolve_sync_state");
    expect(RESPLIT_LOCKS[4]).not.toContain("voximplant_sync_state");
    expect(RESPLIT_LOCKS[5]).toContain("voximplant_sync_state");
    expect(RESPLIT_LOCKS[5]).not.toContain("mcn_sync_state");
    expect(RESPLIT_LOCKS[6]).toContain("mcn_sync_state");
    expect(RESPLIT_LOCKS[0]).toContain("FOR UPDATE");
    expect(RESPLIT_LOCKS[1]).toContain("FOR UPDATE");
    expect(RESPLIT_LOCKS[2]).toContain("FOR UPDATE");
    expect(RESPLIT_LOCKS[3]).toContain("FOR UPDATE");
    expect(RESPLIT_LOCKS[4]).toContain("FOR UPDATE");
    expect(RESPLIT_LOCKS[5]).toContain("FOR UPDATE");
    expect(RESPLIT_LOCKS[6]).toContain("FOR UPDATE");
  });

  it("strips a secret from the stage log", () => {
    expect(sanitizeLogLine("Bearer secret-token")).toBe("Площадка отклонила запрос.");
    expect(sanitizeLogLine("password=secret")).toBe("Площадка отклонила запрос.");
    expect(sanitizeLogLine("https://didapi.runexis.ru/api")).toBe(
      "Площадка отклонила запрос.",
    );
    expect(sanitizeLogLine("Страница 2")).toBe("Страница 2");
  });
});
