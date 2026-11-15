import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  fillStageSplitSql,
  freeMaskBatchSql,
  purchasedClientBatchSql,
  purchasedFullBatchSql,
} from "@/modules/numbering-catalog/decorate";
import { FREE_COPY_SQL, PURCHASED_COPY_SQL } from "@/modules/numbering-sync/sql";
import {
  FREE_COPY_SQL as RUNEXIS_FREE,
  PURCHASED_COPY_SQL as RUNEXIS_PURCHASED,
} from "@/modules/runexis/sql";
import { FREE_COPY_SQL as UIS_FREE, PURCHASED_COPY_SQL as UIS_PURCHASED } from "@/modules/uis/sql";

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

describe("catalog decorate", () => {
  it("fills the draft with the mask lookup and leaves the catalog copy as a copy", () => {
    const split = flattenSql(fillStageSplitSql("uis_sync_stage", "run", 2000));
    expect(split).toContain("rtu_mask_lookup");
    expect(split).toContain("phone_endpoints");
    expect(split).not.toContain("INSERT INTO");
    expect(() => fillStageSplitSql("free_numbers", "run", 1)).toThrow(/черновик/);

    const copies = [
      FREE_COPY_SQL,
      PURCHASED_COPY_SQL,
      RUNEXIS_FREE,
      RUNEXIS_PURCHASED,
      UIS_FREE,
      UIS_PURCHASED,
    ];
    for (const copy of copies) {
      expect(copy).not.toContain("rtu_mask_lookup");
      expect(copy).not.toContain("cdr_tariff_geo");
    }
  });

  it("writes the mask price to sale on free numbers and to purchase on purchased numbers", () => {
    const free = flattenSql(freeMaskBatchSql(""));
    expect(free).toContain("sale = computed.mask_price");
    expect(free).toContain("rtu_mask_lookup");
    expect(free).not.toMatch(/operator\s*=/);
    expect(free).not.toMatch(/geography\s*=/);

    const purchased = flattenSql(purchasedFullBatchSql(""));
    expect(purchased).toContain("purchase = computed.mask_price");
    expect(purchased).toContain("client = computed.client");
    expect(purchased).toContain("rtu_mask_lookup");

    const client = flattenSql(purchasedClientBatchSql(""));
    expect(client).toContain("SET client = computed.client");
    expect(client).not.toContain("rtu_mask_lookup");
  });
});
