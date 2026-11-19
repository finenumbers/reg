import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  AURORA_EPOCH_SQL,
  EXOLVE_EPOCH_SQL,
  FINENUMBERS_EPOCH_SQL,
  MCN_EPOCH_SQL,
  VOXIMPLANT_EPOCH_SQL,
  SIPOUT_EPOCH_SQL,
  UIS_EPOCH_SQL,
  RUNEXIS_EPOCH_SQL,
  fillStageSplitSql,
  MASK_BATCH,
  MASK_BATCH_TX_MS,
  bumpMaskDebtSql,
  bumpTariffDebtSql,
  freeMaskBatchSql,
  markDecorateDoneSql,
  nextDecorateStep,
  providerLiteral,
  snapshotAfterDebt,
  resplitBatchSql,
  saveCursorSql,
  purchasedClientBatchSql,
  pstnBatchSql,
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

function sqlValues(sql: Prisma.Sql): unknown[] {
  const found: unknown[] = [];
  for (const value of sql.values) {
    if (value instanceof Prisma.Sql) found.push(...sqlValues(value));
    else found.push(value);
  }
  return found;
}

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
    expect(MASK_BATCH).toBe(1000);
    expect(MASK_BATCH_TX_MS).toBe(60_000);
    const freeSql = freeMaskBatchSql("");
    expect(freeSql.values).toContain(MASK_BATCH);
    const free = flattenSql(freeSql);
    expect(free).toContain("sale = computed.mask_price");
    expect(free).toContain("abc = computed.abc");
    expect(free).toContain('"number" = computed.telephone');
    expect(free).toContain("city = computed.city");
    expect(free).toContain("region = computed.region");
    expect(free).toContain("rtu_mask_lookup");
    expect(free).toContain("pstn_range_snapshot");
    expect(free).toContain("operator = COALESCE(computed.pstn_operator, n.operator)");
    expect(free).toContain("geography = COALESCE(computed.pstn_geography, n.geography)");
    expect(free).not.toContain("provider =");
    expect(free).not.toContain("client = computed.client");

    const scoped = flattenSql(freeMaskBatchSql("", "SipOut"));
    expect(scoped).toContain("provider = 'SipOut'");
    expect(flattenSql(providerLiteral("Runexis"))).toBe("'Runexis'");
    expect(flattenSql(providerLiteral("Aurora Telecom"))).toBe("'Aurora Telecom'");
    expect(flattenSql(providerLiteral("MTS Exolve"))).toBe("'MTS Exolve'");
    expect(flattenSql(providerLiteral("Voximplant"))).toBe("'Voximplant'");
    expect(flattenSql(providerLiteral("MCN Telecom"))).toBe("'MCN Telecom'");
    expect(flattenSql(providerLiteral("Finenumbers"))).toBe("'Finenumbers'");
    expect(() => providerLiteral("mcn")).toThrow(/источник/);

    const purchased = flattenSql(purchasedFullBatchSql("", "UIS"));
    expect(purchased).toContain("sale = computed.mask_price");
    expect(purchased).not.toContain("purchase = computed.mask_price");
    expect(purchased).toContain("abc = computed.abc");
    expect(purchased).toContain('"number" = computed.telephone');
    expect(purchased).toContain("city = computed.city");
    expect(purchased).toContain("region = computed.region");
    expect(purchased).toContain("client = computed.client");
    expect(purchased).toContain("provider = 'UIS'");
    expect(purchased).toContain("rtu_mask_lookup");
    expect(purchased).toContain(
      "operator = COALESCE(computed.pstn_operator, n.operator)",
    );
    expect(purchased).toContain(
      "geography = COALESCE(computed.pstn_geography, n.geography)",
    );

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
    const oneSide = readFileSync(
      path.join(process.cwd(), "src/modules/numbering-sync/one-side.ts"),
      "utf8",
    );
    expect(oneSide.lastIndexOf("input.epochSql")).toBeGreaterThan(0);
    expect(oneSide.lastIndexOf("input.epochSql")).toBeLessThan(
      oneSide.indexOf('"COMMIT"'),
    );
    const files = [
      ["src/modules/numbering-sync/publish.ts", "SIPOUT_EPOCH_SQL", SIPOUT_EPOCH_SQL],
      ["src/modules/runexis/publish.ts", "RUNEXIS_EPOCH_SQL", RUNEXIS_EPOCH_SQL],
      ["src/modules/uis/publish.ts", "UIS_EPOCH_SQL", UIS_EPOCH_SQL],
      ["src/modules/aurora/publish.ts", "AURORA_EPOCH_SQL", AURORA_EPOCH_SQL],
      ["src/modules/exolve/publish.ts", "EXOLVE_EPOCH_SQL", EXOLVE_EPOCH_SQL],
      ["src/modules/voximplant/publish.ts", "VOXIMPLANT_EPOCH_SQL", VOXIMPLANT_EPOCH_SQL],
      ["src/modules/mcn/publish.ts", "MCN_EPOCH_SQL", MCN_EPOCH_SQL],
      [
        "src/modules/finenumbers/publish.ts",
        "FINENUMBERS_EPOCH_SQL",
        FINENUMBERS_EPOCH_SQL,
      ],
    ] as const;
    for (const [file, symbol, sql] of files) {
      const text = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(text.lastIndexOf(symbol)).toBeGreaterThan(0);
      const commitAt = text.indexOf('"COMMIT"');
      if (commitAt >= 0) {
        expect(text.lastIndexOf(symbol)).toBeLessThan(commitAt);
      } else {
        expect(text).toContain("publishOneSide");
        expect(text).toContain(`epochSql: ${symbol}`);
      }
      expect(sql).toContain("numbering_catalog_state");
      expect(sql).not.toContain("cdr_records");
    }
  });

  it("keeps a resplit batch on the tariff cells and guards the cursor epoch", () => {
    const free = flattenSql(resplitBatchSql("free_numbers", ""));
    const purchased = flattenSql(resplitBatchSql("purchased_numbers", ""));
    for (const sql of [free, purchased]) {
      expect(sql).toContain("cdr_tariff_geo");
      expect(sql).toContain("geography_digit_split");
      expect(sql).toContain("SET");
      expect(sql).toContain("abc = computed.abc");
      expect(sql).not.toContain("rtu_mask_lookup");
      expect(sql).not.toContain("mask");
      expect(sql).not.toContain("client");
      expect(sql).not.toMatch(/operator\s*=/);
      expect(sql).not.toMatch(/geography\s*=/);
    }
    expect(free).toContain("free_numbers");
    expect(purchased).toContain("purchased_numbers");

    const tariffSql = bumpTariffDebtSql();
    const tariff = flattenSql(tariffSql);
    const tariffValues = sqlValues(tariffSql);
    expect(tariff).toContain("resplit_epoch = resplit_epoch + 1");
    expect(tariff).toContain("mask_epoch = mask_epoch + 1");
    expect(tariffValues).toContain("resplit-free");
    expect(tariffValues).toContain("provider-purchased");
    expect(tariffValues).not.toContain("client");

    const maskSql = bumpMaskDebtSql();
    const mask = flattenSql(maskSql);
    const maskValues = sqlValues(maskSql);
    expect(mask).toContain("mask_epoch = mask_epoch + 1");
    expect(mask).not.toContain("resplit_epoch");
    expect(maskValues).not.toContain("resplit-free");
    expect(maskValues).toContain("free");

    const cursor = flattenSql(saveCursorSql("resplit-free", 4, "", "row"));
    expect(cursor).toContain("cursor_after");
    expect(cursor).toContain("resplit_epoch");
    expect(cursor).not.toContain("parsed");
    const providerCursor = flattenSql(
      saveCursorSql("provider-free", 2, "MCN Telecom", "row"),
    );
    expect(providerCursor).toContain("mcn_epoch");
    expect(providerCursor).toContain("mcn_parsed");
    expect(providerCursor).not.toContain("sipout_epoch");
    expect(providerCursor).not.toContain("sipout_parsed");
    const maskCursor = flattenSql(
      saveCursorSql("free", 3, "", "row", { SipOut: 2, "MCN Telecom": 4 }),
    );
    expect(maskCursor).toContain("sipout_parsed");
    expect(maskCursor).toContain("mcn_parsed");
    expect(maskCursor).toContain("parsed_pass");
    expect(flattenSql(freeMaskBatchSql("", null))).toContain("n.provider");
    expect(flattenSql(purchasedFullBatchSql("", null))).toContain("n.provider");
    expect(flattenSql(purchasedClientBatchSql(""))).not.toContain("n.provider");
    expect(flattenSql(bumpMaskDebtSql())).toContain("parsed_pass");
    expect(SIPOUT_EPOCH_SQL).toContain("sipout_parsed = 0");
    expect(SIPOUT_EPOCH_SQL).not.toContain("runexis_parsed");

    const source = readFileSync(
      path.join(process.cwd(), "src/modules/numbering-catalog/decorate.ts"),
      "utf8",
    );
    expect(source).toContain("WHERE id = 1 AND resplit_epoch =");
    expect(source).toContain("WHERE id = 1 AND mask_epoch =");
    expect(source).toContain("WHERE id = 1 AND client_epoch =");
    expect(source).toContain("RETRY_MS = 5_000");
    expect(source).not.toContain("resplitShouldWait");

    const tariffApply = readFileSync(
      path.join(process.cwd(), "src/modules/tariffs/apply.ts"),
      "utf8",
    );
    expect(tariffApply.lastIndexOf("bumpTariffDebtSql()")).toBeGreaterThan(0);
    expect(tariffApply.lastIndexOf("bumpTariffDebtSql()")).toBeLessThan(
      tariffApply.indexOf("}, APPLY_TX)"),
    );
    expect(tariffApply).not.toContain("requestNumberingResplit");
  });

  it("parses a provider before the range-snapshot walk", () => {
    const caught = {
      decorate_generation: 1,
      sipout_epoch: 1,
      sipout_done: 1,
      runexis_epoch: 1,
      runexis_done: 1,
      uis_epoch: 1,
      uis_done: 1,
      aurora_epoch: 1,
      aurora_done: 1,
      exolve_epoch: 1,
      exolve_done: 1,
      voximplant_epoch: 1,
      voximplant_done: 1,
      mcn_epoch: 1,
      mcn_done: 1,
      finenumbers_epoch: 1,
      finenumbers_done: 1,
      resplit_epoch: 1,
      resplit_done: 1,
      mask_epoch: 1,
      mask_done: 1,
      pstn_range_epoch: 1,
      pstn_range_done: 1,
      client_epoch: 1,
      client_done: 1,
    };
    expect(
      nextDecorateStep({
        ...caught,
        decorate_generation: 0,
        finenumbers_epoch: 2,
        pstn_range_epoch: 2,
      }),
    ).toEqual({ kind: "bootstrap" });
    expect(
      nextDecorateStep({
        ...caught,
        mask_epoch: 2,
        finenumbers_epoch: 2,
        pstn_range_epoch: 2,
      }),
    ).toEqual({ kind: "mask" });
    expect(
      nextDecorateStep({
        ...caught,
        finenumbers_epoch: 2,
        pstn_range_epoch: 2,
      }),
    ).toEqual({ kind: "provider", provider: "Finenumbers" });
    expect(
      nextDecorateStep({
        ...caught,
        sipout_epoch: 2,
        finenumbers_epoch: 2,
        pstn_range_epoch: 2,
      }),
    ).toEqual({ kind: "provider", provider: "SipOut" });
    expect(nextDecorateStep({ ...caught, pstn_range_epoch: 2 })).toEqual({
      kind: "pstn",
    });
    expect(nextDecorateStep({ ...caught, client_epoch: 2 })).toEqual({ kind: "client" });
    expect(nextDecorateStep(caught)).toEqual({ kind: "idle" });
    expect(nextDecorateStep({ ...caught, resplit_epoch: 2, mask_epoch: 2 })).toEqual({
      kind: "resplit",
    });
    expect(snapshotAfterDebt({ kind: "provider", provider: "Aurora Telecom" })).toBe(
      false,
    );
    expect(snapshotAfterDebt({ kind: "provider", provider: "Finenumbers" })).toBe(false);
    expect(snapshotAfterDebt({ kind: "provider", provider: "SipOut" })).toBe(false);
    expect(snapshotAfterDebt({ kind: "mask" })).toBe(false);
    expect(snapshotAfterDebt({ kind: "resplit" })).toBe(false);
    expect(snapshotAfterDebt({ kind: "pstn" })).toBe(true);
    expect(snapshotAfterDebt({ kind: "idle" })).toBe(true);
  });

  it("looks up a covering range by the span index", () => {
    const batches = [
      flattenSql(freeMaskBatchSql("", "SipOut")),
      flattenSql(purchasedFullBatchSql("", "UIS")),
      flattenSql(pstnBatchSql("free_numbers", "")),
      flattenSql(pstnBatchSql("purchased_numbers", "")),
    ];
    for (const sql of batches) {
      expect(sql).toContain("int4range(s.range_start, s.range_end, '[]') @>");
      expect(sql).toContain("digits.local_key IS NOT NULL");
      expect(sql).toContain("s.abc = digits.abc_key");
      expect(sql).not.toContain("BETWEEN");
      const castAt = sql.indexOf("from 5)::int");
      expect(castAt).toBeGreaterThan(0);
      const before = sql.slice(0, castAt);
      expect(before.lastIndexOf("CASE")).toBeGreaterThan(before.lastIndexOf("END"));
    }
    const free = batches[0] ?? "";
    expect(free).toContain("abc = computed.abc");
    expect(free).toContain("sale = computed.mask_price");
    expect(free).toContain("rtu_mask_lookup");
    expect(free).toContain("operator = COALESCE(computed.pstn_operator, n.operator)");
    const purchased = batches[1] ?? "";
    expect(purchased).toContain("abc = computed.abc");
    expect(purchased).toContain("sale = computed.mask_price");
    expect(purchased).not.toContain("purchase = computed.mask_price");
    expect(purchased).toContain("client = computed.client");
    const pstn = batches[2] ?? "";
    expect(pstn).not.toContain("rtu_mask_lookup");
    expect(pstn).toContain("operator = COALESCE(computed.pstn_operator, n.operator)");

    const migration = readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20261117180000_pstn_range_span/migration.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist");
    expect(migration).toContain("USING gist");
    expect(migration).toContain('"abc"');
    expect(migration).toContain('int4range("range_start", "range_end", \'[]\')');
    expect(migration).toContain('ANALYZE "pstn_range_snapshot"');
    expect(migration).toContain("lock_timeout = '15s'");
    expect(migration).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM)\b/);

    const swap = readFileSync(
      path.join(process.cwd(), "src/modules/numbering-catalog/pstn-ranges.ts"),
      "utf8",
    );
    expect(swap).toContain("timeout: 600_000");
    expect(swap).toContain("ANALYZE pstn_range_snapshot");
    expect(swap).toContain("throw error");
  });
});
