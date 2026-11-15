import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { RESPLIT_LOCKS } from "@/modules/numbering-sync/recompute";
import {
  acceptShowcasePage,
  freePrices,
  nationalDigits,
  parseAccessToken,
  parseManagementPage,
  parseSession,
  parseShowcasePage,
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
import { catalogUrl, loginUrl, refreshUrl, showcaseUrl } from "@/modules/runexis/url";

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
  it("asks only for a page of 30", () => {
    expect(loginUrl()).toBe("https://didapi.runexis.ru/api/v1/login");
    expect(showcaseUrl(0)).toBeNull();
    expect(showcaseUrl(1.5)).toBeNull();
    const url = new URL(showcaseUrl(2) ?? "");
    expect(url.origin).toBe("https://didapi.runexis.ru");
    expect(url.pathname).toBe("/api/v1/numbers/showcase");
    expect([...url.searchParams.keys()].sort()).toEqual(["limit", "page"]);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("30");
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
      meta: { total: 3, page: 1, limit: 30 },
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
    expect(acceptShowcasePage({ total: 0, got: 0, acceptedBefore: 0 })).toBe("done");
    expect(acceptShowcasePage({ total: 31, got: 1, acceptedBefore: 30 })).toBe("done");
    expect(acceptShowcasePage({ total: 40, got: 10, acceptedBefore: 0 })).toBe("short");
    expect(acceptShowcasePage({ total: 10, got: 30, acceptedBefore: 0 })).toBe("over");
    expect(acceptShowcasePage({ total: 60, got: 30, acceptedBefore: 0 })).toBe("next");
    expect(parseAccessToken({ success: true, data: { token: "abc def" } })).toBeNull();
    expect(parseAccessToken({ success: true, data: { token: "abc" } })).toBe("abc");
  });

  it("replaces Runexis rows in both catalogs", () => {
    expect(catalogUrl("management", 2)).toContain("/api/v1/numbers/management");
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
    expect(PURCHASED_COPY_SQL).toContain("INSERT INTO purchased_numbers");
    expect(PURCHASED_COPY_SQL).not.toContain("incoming");
    expect(
      flattenSql(
        stageFreeSql("run", [
          { e164: "79011234567", incomingPurchase: "1", incomingPeriod: "" },
        ]),
      ),
    ).toContain("incoming_purchase");
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

  it("locks SipOut before Runexis", () => {
    expect(RESPLIT_LOCKS).toHaveLength(2);
    expect(RESPLIT_LOCKS[0]).toContain("numbering_sync_state");
    expect(RESPLIT_LOCKS[0]).not.toContain("runexis_sync_state");
    expect(RESPLIT_LOCKS[1]).toContain("runexis_sync_state");
    expect(RESPLIT_LOCKS[0]).toContain("FOR UPDATE");
    expect(RESPLIT_LOCKS[1]).toContain("FOR UPDATE");
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
