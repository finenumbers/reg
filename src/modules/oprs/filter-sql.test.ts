import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import { emptyBlockedNumberIndex } from "@/modules/phones/blocked-numbers";
import { CDR_BLOCKED_FIELDS } from "@/modules/traffic/blocked-number";
import { facetSearchMatch } from "@/modules/traffic/facet-search";
import { facetSearchWhere } from "@/modules/traffic/service";
import { OPRS_LIST_SELECT } from "@/modules/oprs/row";
import {
  buildOprsFacetSql,
  buildOprsSliceSql,
  escapeLike,
  oprsFacetMatchSql,
  oprsMarkingJson,
  oprsNeedsComputedSql,
  oprsStoredColumnSql,
  requireOprsMonthPrefix,
  type OprsSqlContext,
  type OprsSqlInput,
} from "@/modules/oprs/filter-sql";
import { OprsQueryError } from "@/modules/oprs/where";

const SNAPSHOT = new Date("2026-11-13T06:00:00.000Z");

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

function input(patch: Partial<OprsSqlInput> = {}): OprsSqlInput {
  return {
    year: 2026,
    month: 11,
    filters: {},
    phoneQ: "",
    flags: {},
    snapshot: SNAPSHOT,
    cursor: null,
    timeSort: null,
    ...patch,
  };
}

function ctx(patch: Partial<OprsSqlContext> = {}): OprsSqlContext {
  return {
    tones: {},
    labelUnpainted: false,
    blocked: emptyBlockedNumberIndex(),
    marking: null,
    guiHost: "",
    ...patch,
  };
}

function sliceText(query: OprsSqlInput, context: OprsSqlContext) {
  const slice = buildOprsSliceSql(query, context);
  return flattenSql(Prisma.sql`${slice.from} WHERE ${slice.where}`);
}

describe("oprs computed sql", () => {
  it("refuses a bad month and a column that is not on the allowlist", () => {
    expect(() => requireOprsMonthPrefix(2026, 0)).toThrow(OprsQueryError);
    expect(() => requireOprsMonthPrefix(2026, 13)).toThrow(OprsQueryError);
    expect(requireOprsMonthPrefix(2026, 11)).toBe("2026-11-");
    expect(() => oprsStoredColumnSql("geography_b")).toThrow(OprsQueryError);
    expect(oprsNeedsComputedSql({ call_status: ["OK"] })).toBe(false);
    expect(oprsNeedsComputedSql({ oprs_network: ["МТС"] })).toBe(true);
    expect(oprsNeedsComputedSql({}, "oprs_marking")).toBe(true);
  });

  it("keeps the registry miss out and paints only the selected network", () => {
    const flat = sliceText(
      input({
        filters: {
          geography_b: ["Москва"],
          oprs_network: ["МТС"],
          dst_name: ["Service_Parking_1"],
        },
      }),
      ctx({ tones: { "ПАО МТС": "red", Мега: "green" } }),
    );
    expect(flat.text).not.toContain("Москва");
    expect(flat.values).not.toContain("Москва");
    expect(flat.values).toContain("2026-11-%");
    expect(flat.text).not.toContain("||");
    expect(flat.values).toContain(MISSING_PSTN_LABEL);
    expect(flat.values).toContain("МТС");
    expect(flat.values).toContain("ПАО МТС");
    expect(flat.values).toContain("Service_Parking_1");
    expect(flat.text).not.toContain("unnest");
    expect(flat.text).not.toContain("jsonb_to_recordset");
    expect(flat.text).not.toContain("voipmonitor_legs");
    expect(flat.text).toContain("FALSE");
  });

  it("checks the same blocked fields the row uses", () => {
    for (const field of CDR_BLOCKED_FIELDS) {
      expect(OPRS_LIST_SELECT).toHaveProperty(field);
    }
    const flat = sliceText(
      input({ filters: { oprs_network: ["МТС"] } }),
      ctx({
        tones: { "ПАО МТС": "red" },
        blocked: { exact: new Set(["70000000000"]), pstn: new Set(["9001112233"]) },
      }),
    );
    expect(flat.text).toContain("unnest");
    expect(flat.text).toContain("in_ani");
    expect(flat.text).toContain("out_orig_dnis");
    expect(flat.text).toContain("auth_dnis");
    expect(flat.text).not.toContain("src_user");
    expect(flat.values).toContain("70000000000");
    expect(flat.values).toContain("9001112233");
  });

  it("sends the marking catalog as one JSON value and the calltrace token", () => {
    const marking = oprsMarkingJson(
      new Map([
        [
          "74951234567",
          {
            labelMts: "vip",
            labelMegafon: "",
            labelBeeline: "",
            labelT2: "",
            mavMts: "",
            mavMegafon: "",
            mavBeeline: "",
            mavT2: "",
          },
        ],
        [
          "70000000000",
          {
            labelMts: "",
            labelMegafon: "",
            labelBeeline: "",
            labelT2: "",
            mavMts: "",
            mavMegafon: "",
            mavBeeline: "",
            mavT2: "",
          },
        ],
      ]),
    );
    expect(marking).toContain("74951234567");
    expect(marking).toContain("vip");
    expect(marking).not.toContain("70000000000");

    const flat = sliceText(
      input({
        filters: { oprs_marking: ["vip"], voipmonitor_url_in: ["открыть"] },
        phoneQ: "%",
      }),
      ctx({
        tones: { "ПАО МТС": "red" },
        marking: new Map([
          [
            "74951234567",
            {
              labelMts: "vip",
              labelMegafon: "",
              labelBeeline: "",
              labelT2: "",
              mavMts: "m",
              mavMegafon: "",
              mavBeeline: "",
              mavT2: "",
            },
          ],
        ]),
        guiHost: "gui.example",
      }),
    );
    expect(flat.text).toContain("jsonb_to_recordset");
    expect(flat.text).toContain("voipmonitor_legs");
    expect(flat.text).toContain(":443");
    expect(flat.text).toContain("ESCAPE");
    expect(flat.values).toContain("открыть");
    expect(flat.values).toContain("gui.example");
    expect(
      flat.values.some((value) => typeof value === "string" && value.includes("vip")),
    ).toBe(true);
    expect(flat.values).toContain(`%${escapeLike("%")}%`);
    expect(flat.text).toContain("ESCAPE E'\\\\'");
  });

  it("uses one aggregate and the same search tokens as the stored menu", () => {
    const facet = flattenSql(
      buildOprsFacetSql(
        input({ filters: { call_status: ["OK"] } }),
        ctx({ tones: { "ПАО МТС": "red" } }),
        "oprs_network",
        "мт",
        50,
      ),
    );
    expect(facet.text.split("GROUP BY").length - 1).toBe(1);
    expect(facet.text).toContain("COUNT(*)");
    expect(facet.values).toContain("OK");
    expect(facet.values).toContain(`%${escapeLike("мт")}%`);

    const elapsed = facetSearchMatch("elapsed_time", "10");
    expect(elapsed.kind).toBe("in");
    const elapsedSql = flattenSql(
      oprsFacetMatchSql("elapsed_time", Prisma.sql`c.elapsed_time`, "10"),
    );
    if (elapsed.kind === "in") {
      for (const value of elapsed.values) expect(elapsedSql.values).toContain(value);
    }
    const where = facetSearchWhere("elapsedTime", "elapsed_time", "10");
    expect(JSON.stringify(where)).toContain("9001");

    const day = facetSearchMatch("cdr_day", "13.11");
    const daySql = flattenSql(
      oprsFacetMatchSql("cdr_day", Prisma.sql`c.cdr_day`, "13.11"),
    );
    if (day.kind === "contains") {
      for (const needle of day.needles) {
        expect(daySql.values).toContain(`%${escapeLike(needle)}%`);
      }
    }

    const empty = flattenSql(
      oprsFacetMatchSql("call_status", Prisma.sql`c.call_status`, "пусто"),
    );
    expect(empty.text).toContain("= ''");
    expect(empty.values).toContain(`%${escapeLike("пусто")}%`);
    expect(EMPTY_FILTER_TOKEN).toBe("__empty__");
  });

  it("names an unpainted network only when the tone map is complete", () => {
    const open = sliceText(
      input({ filters: { oprs_network: ["Внешние сети"] } }),
      ctx({ tones: { "ПАО МТС": "red" }, labelUnpainted: true }),
    );
    expect(open.values).toContain("Внешние сети");
    expect(open.values).toContain("МТС");
    expect(open.text).toContain("THEN ''");

    const held = sliceText(
      input({ filters: { oprs_network: ["МТС"] } }),
      ctx({ tones: { "ПАО МТС": "red" }, labelUnpainted: false }),
    );
    expect(held.values).not.toContain("Внешние сети");
    expect(held.text).toContain("ELSE ''");
  });
});
