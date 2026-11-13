import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import { markingImportPayload, markingSetDetails } from "@/modules/marking/payload";
import type { MarkingParsedRow } from "@/modules/marking/parse-xlsx";
import {
  markingApplySql,
  markingExportSql,
  markingFilterSql,
  markingListSql,
  markingSupplierSyncSql,
} from "@/modules/marking/sql";
import { STATUS_NOT_IN_RTU } from "@/modules/rtu/types";

function flattenSql(sql: Prisma.Sql): { text: string; values: unknown[] } {
  const text: string[] = [];
  const values: unknown[] = [];
  for (let i = 0; i < sql.strings.length; i++) {
    text.push(sql.strings[i] ?? "");
    if (i >= sql.values.length) continue;
    const value = sql.values[i];
    if (value instanceof Prisma.Sql) {
      const inner = flattenSql(value);
      text.push(inner.text);
      values.push(...inner.values);
    } else {
      text.push("?");
      values.push(value);
    }
  }
  return { text: text.join(""), values };
}

function row(phone: string, labelMts: string | null = null): MarkingParsedRow {
  return {
    sortIndex: 0,
    client: "Клиент",
    phoneNumber: phone,
    labelMts,
    labelMegafon: null,
    labelBeeline: null,
    labelT2: null,
    mavMts: null,
    mavMegafon: null,
    mavBeeline: null,
    mavT2: null,
  };
}

describe("marking working set", () => {
  it("uses one predicate for the list, the export, and the import", () => {
    const where = markingFilterSql(undefined);
    const list = flattenSql(markingListSql({ where, cursor: null, limit: 100 }));
    const exported = flattenSql(markingExportSql(10));
    const applied = flattenSql(markingApplySql("[]", "a.xlsx", new Date("2026-11-13T00:00:00.000Z")));
    for (const sql of [list, exported, applied]) {
      expect(sql.text).toContain("/* marking-working-set */");
      expect(sql.text).toContain("NOT missing");
      expect(sql.text).toContain("pstn_phone_cache");
      expect(sql.text).not.toContain("pstnCacheKey");
      expect(sql.values).toContain(STATUS_NOT_IN_RTU);
      expect(sql.values).toContain(MISSING_PSTN_LABEL);
    }
    expect(exported.text).not.toContain(EMPTY_FILTER_TOKEN);
    expect(applied.text).toContain("jsonb_to_recordset");
    expect(applied.text).not.toContain("DELETE");
    const update = applied.text.slice(
      applied.text.indexOf("DO UPDATE SET"),
      applied.text.indexOf("RETURNING"),
    );
    expect(update).toContain('"labelMts"');
    expect(update).toContain('"mavT2"');
    expect(update).toContain("supplier = EXCLUDED.supplier");
    expect(update).not.toContain("client");
    expect(update).not.toContain("sortIndex");
    expect(applied.text).toContain("w.supplier");
    expect(applied.text).toContain("INNER JOIN working w");
    const synced = flattenSql(markingSupplierSyncSql());
    expect(synced.text).toContain("UPDATE marking_rows");
    expect(synced.text).toContain("IS DISTINCT FROM working.supplier");
    expect(synced.text).not.toContain("jsonb_to_recordset");
  });

  it("binds a phone filter and keeps an empty label as an empty cell", () => {
    const sql = flattenSql(
      markingFilterSql({
        phoneNumber: ["74951234567"],
        labelMts: [EMPTY_FILTER_TOKEN, "А"],
      }),
    );
    expect(sql.text).toContain("number IN");
    expect(sql.text).toContain("COALESCE(label_mts, '') = ''");
    expect(sql.values).toContain("74951234567");
    expect(sql.values).toContain("А");
    expect(sql.values).not.toContain(EMPTY_FILTER_TOKEN);
  });
});

describe("marking import payload", () => {
  it("keeps each label on its own phone", () => {
    const payload = JSON.parse(
      markingImportPayload([
        row("74951234567", "МТС"),
        { ...row("123"), labelMegafon: "Мега" },
      ]),
    ) as unknown[];
    expect(payload).toEqual([
      {
        phone: "74951234567",
        labelMts: "МТС",
        labelMegafon: null,
        labelBeeline: null,
        labelT2: null,
        mavMts: null,
        mavMegafon: null,
        mavBeeline: null,
        mavT2: null,
      },
      {
        phone: "123",
        labelMts: null,
        labelMegafon: "Мега",
        labelBeeline: null,
        labelT2: null,
        mavMts: null,
        mavMegafon: null,
        mavBeeline: null,
        mavT2: null,
      },
    ]);
  });

  it("counts missing and unknown numbers past the sample", () => {
    const details = markingSetDetails({
      workingN: 3,
      incomingN: 2,
      incomingDistinct: 2,
      matched: 1,
      missing: ["74950000001", "74950000002"],
      unknown: ["000"],
    });
    expect(details[0]).toBe("Не хватает в файле: 2. Нет в разделе: 1.");
    expect(details).toContain("Номер 74950000001 есть в разделе и отсутствует в файле");
    expect(details).toContain("Номер 000 есть в файле и отсутствует в разделе");
  });

  it("reports a repeated phone before the set comparison", () => {
    expect(
      markingSetDetails({
        workingN: 1,
        incomingN: 2,
        incomingDistinct: 1,
        matched: 2,
        missing: [],
        unknown: [],
      }),
    ).toEqual(["Повтор номера. Снимок не изменён."]);
  });
});
