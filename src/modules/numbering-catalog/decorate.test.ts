import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  AURORA_EPOCH_SQL,
  EXOLVE_EPOCH_SQL,
  MCN_EPOCH_SQL,
  VOXIMPLANT_EPOCH_SQL,
  SIPOUT_EPOCH_SQL,
  UIS_EPOCH_SQL,
  RUNEXIS_EPOCH_SQL,
  fillStageSplitSql,
  freeMaskBatchSql,
  markDecorateDoneSql,
  providerLiteral,
  purchasedClientBatchSql,
  purchasedFullBatchSql,
} from "@/modules/numbering-catalog/decorate";
import { FREE_COPY_SQL, PURCHASED_COPY_SQL } from "@/modules/numbering-sync/sql";
import {
  FREE_COPY_SQL as RUNEXIS_FREE,
  PURCHASED_COPY_SQL as RUNEXIS_PURCHASED,
} from "@/modules/runexis/sql";
import {
  FREE_COPY_SQL as UIS_FREE,
  PURCHASED_COPY_SQL as UIS_PURCHASED,
} from "@/modules/uis/sql";
import {
  FREE_COPY_SQL as AURORA_FREE,
  PURCHASED_COPY_SQL as AURORA_PURCHASED,
} from "@/modules/aurora/sql";

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

function fieldCount(sql: string, start: string, end: string): number {
  const from = sql.indexOf(start);
  const to = sql.indexOf(end, from + start.length);
  return sql.slice(from + start.length, to).split(",").length;
}

describe("catalog decorate", () => {
  it("fills the draft with the tariff only and copies empty mask cells", () => {
    const split = flattenSql(fillStageSplitSql("uis_sync_stage", "run", 2000));
    const auroraSplit = flattenSql(fillStageSplitSql("aurora_sync_stage", "run", 2000));
    const voximplantSplit = flattenSql(
      fillStageSplitSql("voximplant_sync_stage", "run", 2000),
    );
    const mcnSplit = flattenSql(fillStageSplitSql("mcn_sync_stage", "run", 2000));
    expect(voximplantSplit).toContain("voximplant_sync_stage");
    expect(mcnSplit).toContain("mcn_sync_stage");
    expect(auroraSplit).toContain("cdr_tariff_geo");
    expect(auroraSplit).toContain("aurora_sync_stage");
    expect(split).toContain("cdr_tariff_geo");
    expect(split).not.toContain("rtu_mask_lookup");
    expect(split).not.toContain("phone_endpoints");
    expect(split).not.toContain("INSERT INTO");
    expect(() => fillStageSplitSql("free_numbers", "run", 1)).toThrow(/черновик/);

    const copies = [
      FREE_COPY_SQL,
      PURCHASED_COPY_SQL,
      RUNEXIS_FREE,
      RUNEXIS_PURCHASED,
      UIS_FREE,
      UIS_PURCHASED,
      AURORA_FREE,
      AURORA_PURCHASED,
    ];
    for (const copy of copies) {
      expect(copy).not.toContain("rtu_mask_lookup");
      expect(copy).not.toContain("cdr_tariff_geo");
      expect(copy).not.toContain("mask_price");
    }
    expect(fieldCount(RUNEXIS_FREE, "INSERT INTO free_numbers (", ")")).toBe(
      fieldCount(RUNEXIS_FREE, "SELECT", "FROM"),
    );
    expect(fieldCount(RUNEXIS_PURCHASED, "INSERT INTO purchased_numbers (", ")")).toBe(
      fieldCount(RUNEXIS_PURCHASED, "SELECT", "FROM"),
    );
    expect(fieldCount(FREE_COPY_SQL, "INSERT INTO free_numbers (", ")")).toBe(
      fieldCount(FREE_COPY_SQL, "SELECT", "FROM ("),
    );
    expect(fieldCount(PURCHASED_COPY_SQL, "INSERT INTO purchased_numbers (", ")")).toBe(
      fieldCount(PURCHASED_COPY_SQL, "SELECT", "FROM ("),
    );
  });

  it("writes the mask price to sale on free numbers and to purchase on purchased numbers", () => {
    const free = flattenSql(freeMaskBatchSql(""));
    expect(free).toContain("sale = computed.mask_price");
    expect(free).toContain("rtu_mask_lookup");
    expect(free).not.toMatch(/operator\s*=/);
    expect(free).not.toMatch(/geography\s*=/);
    expect(free).not.toContain("provider =");

    const scoped = flattenSql(freeMaskBatchSql("", "SipOut"));
    expect(scoped).toContain("provider = 'SipOut'");
    expect(flattenSql(providerLiteral("Runexis"))).toBe("'Runexis'");
    expect(flattenSql(providerLiteral("Aurora Telecom"))).toBe("'Aurora Telecom'");
    expect(flattenSql(providerLiteral("MTS Exolve"))).toBe("'MTS Exolve'");
    expect(flattenSql(providerLiteral("Voximplant"))).toBe("'Voximplant'");
    expect(flattenSql(providerLiteral("MCN Telecom"))).toBe("'MCN Telecom'");
    expect(() => providerLiteral("mcn")).toThrow(/источник/);

    const purchased = flattenSql(purchasedFullBatchSql("", "UIS"));
    expect(purchased).toContain("purchase = computed.mask_price");
    expect(purchased).toContain("client = computed.client");
    expect(purchased).toContain("provider = 'UIS'");
    expect(purchased).toContain("rtu_mask_lookup");

    const client = flattenSql(purchasedClientBatchSql(""));
    expect(client).toContain("SET client = computed.client");
    expect(client).not.toContain("rtu_mask_lookup");
    expect(client).not.toContain("sipout_done");

    const auroraDone = flattenSql(markDecorateDoneSql("Aurora Telecom", 2));
    expect(auroraDone).toContain("aurora_done");
    expect(auroraDone).toContain("aurora_epoch");
    const exolveDone = flattenSql(markDecorateDoneSql("MTS Exolve", 3));
    expect(exolveDone).toContain("exolve_done");
    expect(exolveDone).toContain("exolve_epoch");
    const voximplantDone = flattenSql(markDecorateDoneSql("Voximplant", 5));
    expect(voximplantDone).toContain("voximplant_done");
    expect(voximplantDone).toContain("voximplant_epoch");
    const mcnDone = flattenSql(markDecorateDoneSql("MCN Telecom", 6));
    expect(mcnDone).toContain("mcn_done");
    expect(mcnDone).toContain("mcn_epoch");
    const done = flattenSql(markDecorateDoneSql("SipOut", 4));
    expect(done).toContain("sipout_done");
    expect(done).toContain("sipout_epoch");
    expect(done).not.toContain("runexis_done");
    expect(() => markDecorateDoneSql("mcn", 1)).toThrow(/источник/);
  });

  it("increments the provider epoch before the catalog commit", () => {
    const files = [
      ["src/modules/numbering-sync/publish.ts", "SIPOUT_EPOCH_SQL", SIPOUT_EPOCH_SQL],
      ["src/modules/runexis/publish.ts", "RUNEXIS_EPOCH_SQL", RUNEXIS_EPOCH_SQL],
      ["src/modules/uis/publish.ts", "UIS_EPOCH_SQL", UIS_EPOCH_SQL],
      ["src/modules/aurora/publish.ts", "AURORA_EPOCH_SQL", AURORA_EPOCH_SQL],
      ["src/modules/exolve/publish.ts", "EXOLVE_EPOCH_SQL", EXOLVE_EPOCH_SQL],
      ["src/modules/voximplant/publish.ts", "VOXIMPLANT_EPOCH_SQL", VOXIMPLANT_EPOCH_SQL],
      ["src/modules/mcn/publish.ts", "MCN_EPOCH_SQL", MCN_EPOCH_SQL],
    ] as const;
    for (const [file, symbol, sql] of files) {
      const text = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(text.lastIndexOf(symbol)).toBeGreaterThan(0);
      expect(text.lastIndexOf(symbol)).toBeLessThan(text.indexOf('"COMMIT"'));
      expect(sql).toContain("numbering_catalog_state");
      expect(sql).not.toContain("cdr_records");
    }
  });
});
