import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import { csvHeaderToCamel } from "@/modules/traffic/columns";
import {
  applyColumnFilters,
  applyPhoneQ,
  containsInsensitive,
  facetSearchWhere,
} from "@/modules/traffic/service";

describe("containsInsensitive", () => {
  it("sets Prisma contains mode to insensitive", () => {
    expect(containsInsensitive("мтс")).toEqual({
      contains: "мтс",
      mode: "insensitive",
    });
  });
});

describe("facetSearchWhere", () => {
  it("uses insensitive contains for ordinary columns", () => {
    expect(facetSearchWhere("operatorA", "operator_a", "мтс")).toEqual({
      operatorA: { contains: "мтс", mode: "insensitive" },
    });
  });

  it("uses insensitive contains for each cdr_date needle", () => {
    const where = facetSearchWhere("cdrDate", "cdr_date", "28.12.2026");
    expect(where).toEqual({
      OR: [
        { cdrDate: { contains: "28.12.2026", mode: "insensitive" } },
        { cdrDate: { contains: "2026-12-28", mode: "insensitive" } },
      ],
    });
  });

  it("searches cdr_day without a time suffix needle", () => {
    expect(facetSearchWhere("cdrDay", "cdr_day", "28.12.2026, 01:23:43")).toEqual(
      {
        OR: [
          {
            cdrDay: {
              contains: "28.12.2026, 01:23:43",
              mode: "insensitive",
            },
          },
          { cdrDay: { contains: "2026-12-28", mode: "insensitive" } },
        ],
      },
    );
  });

  it("searches cdr_time with the extracted clock", () => {
    expect(facetSearchWhere("cdrTime", "cdr_time", "28.12.2026, 01:23:43")).toEqual(
      {
        OR: [
          {
            cdrTime: {
              contains: "28.12.2026, 01:23:43",
              mode: "insensitive",
            },
          },
          { cdrTime: { contains: "01:23:43", mode: "insensitive" } },
        ],
      },
    );
  });

  it("keeps duration exact-in without a case mode", () => {
    const where = facetSearchWhere("elapsedTime", "elapsed_time", "10");
    expect(where).toHaveProperty("elapsedTime.in");
    const values = (where as { elapsedTime: { in: string[] } }).elapsedTime.in;
    expect(values).toContain("10");
    expect(values).toContain("9900");
  });

  it("adds an empty-string OR when the query matches «(пусто)»", () => {
    expect(facetSearchWhere("billAni", "bill_ani", "пусто")).toEqual({
      OR: [
        { billAni: { contains: "пусто", mode: "insensitive" } },
        { billAni: "" },
      ],
    });
    expect(facetSearchWhere("billAni", "bill_ani", "(пусто)")).toMatchObject({
      OR: expect.arrayContaining([{ billAni: "" }]),
    });
    expect(facetSearchWhere("billAni", "bill_ani", "ПУСТО")).toMatchObject({
      OR: expect.arrayContaining([{ billAni: "" }]),
    });
    expect(facetSearchWhere("billAni", "bill_ani", "пуст")).toMatchObject({
      OR: expect.arrayContaining([{ billAni: "" }]),
    });
  });

  it("does not add the empty group for digits or a single letter", () => {
    expect(facetSearchWhere("billAni", "bill_ani", "7900")).toEqual({
      billAni: { contains: "7900", mode: "insensitive" },
    });
    expect(facetSearchWhere("billAni", "bill_ani", "о")).toEqual({
      billAni: { contains: "о", mode: "insensitive" },
    });
    expect(facetSearchWhere("billAni", "bill_ani", "(")).toEqual({
      billAni: { contains: "(", mode: "insensitive" },
    });
  });

  it("keeps date needles flat when adding the empty group", () => {
    const where = facetSearchWhere("cdrDate", "cdr_date", "пусто");
    expect(where).toEqual({
      OR: [
        { cdrDate: { contains: "пусто", mode: "insensitive" } },
        { cdrDate: "" },
      ],
    });
  });
});

describe("applyColumnFilters", () => {
  const month = { cdrDate: { startsWith: "2026-08-" } };

  it("ANDs day and time exact tokens", () => {
    expect(
      applyColumnFilters(month, {
        cdr_day: ["2026-08-30"],
        cdr_time: ["14:22:52"],
      }),
    ).toEqual({
      AND: [
        month,
        { OR: [{ cdrDay: "2026-08-30" }] },
        { OR: [{ cdrTime: "14:22:52" }] },
      ],
    });
  });

  it("ORs multiple values in one column", () => {
    expect(
      applyColumnFilters(month, {
        cdr_day: ["2026-08-30", "2026-08-29"],
      }),
    ).toEqual({
      AND: [
        month,
        { OR: [{ cdrDay: "2026-08-30" }, { cdrDay: "2026-08-29" }] },
      ],
    });
  });

  it("excludes the open column so mutual facets stay honest", () => {
    expect(
      applyColumnFilters(
        month,
        { cdr_day: ["2026-08-30"], cdr_time: ["14:22:52"] },
        { excludeColumn: "cdr_day" },
      ),
    ).toEqual({
      AND: [month, { OR: [{ cdrTime: "14:22:52" }] }],
    });
  });

  it("maps the empty token to a blank stored part", () => {
    expect(
      applyColumnFilters(month, { cdr_day: [EMPTY_FILTER_TOKEN] }),
    ).toEqual({
      AND: [month, { OR: [{ cdrDay: "" }] }],
    });
  });
});

describe("applyPhoneQ", () => {
  it("adds insensitive contains on billing and signalling numbers", () => {
    const where = applyPhoneQ({}, "Abc");
    expect(where).toEqual({
      AND: [
        {},
        {
          OR: [
            "in_ani",
            "in_dnis",
            "out_ani",
            "out_dnis",
            "bill_ani",
            "bill_dnis",
          ].map((col) => ({
            [csvHeaderToCamel(col)]: {
              contains: "Abc",
              mode: "insensitive",
            },
          })),
        },
      ],
    });
  });

  it("leaves the base where unchanged when the query is blank", () => {
    const base = { cdrId: "1" };
    expect(applyPhoneQ(base, "  ")).toBe(base);
  });
});
