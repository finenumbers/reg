import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { querySmgFacetValues, querySmgIdPage } from "@/modules/smg/call-query";
import { AF_CATEGORY, AF_STATUS } from "@/modules/smg-trace/classify";

const month = { year: 2026, month: 10, key: "2026-10" };

function sqlText(value: unknown): string {
  const sql = value as Prisma.Sql;
  return `${sql.strings.join("?")} ${JSON.stringify(sql.values)}`;
}

describe("querySmgIdPage", () => {
  it("filters the start day with the same trim and stamp shape the cell uses", async () => {
    const seen: string[] = [];
    const query = (async (sql: Prisma.Sql) => {
      seen.push(sqlText(sql));
      return seen.length === 1 ? [{ n: 1 }] : [{ id: "cdr-1" }];
    }) as unknown as SqlQuery;

    const page = await querySmgIdPage(
      query,
      {
        month,
        device: "gw",
        phoneQ: "",
        filters: { setupDay: ["2026-10-13"] },
        setupSort: null,
        skip: 0,
        take: 100,
      },
      async () => new Map(),
    );

    expect(page).toEqual({ ids: ["cdr-1"], total: 1 });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("btrim");
    expect(seen[0]).toContain("setup_time");
    expect(seen.join("\n")).not.toContain("antifraud");
  });

  it("keeps a two-card row on the conflict label and pages in SQL when nothing is pending", async () => {
    const seen: string[] = [];
    const query = (async (sql: Prisma.Sql) => {
      seen.push(sqlText(sql));
      if (seen.length === 1) return [{ n: 0 }];
      if (seen.length === 2) return [{ n: 4 }];
      return [{ id: "cdr-2" }];
    }) as unknown as SqlQuery;

    const page = await querySmgIdPage(
      query,
      {
        month,
        device: "gw",
        phoneQ: "",
        filters: { antifraud: [AF_CATEGORY.conflict] },
        setupSort: "desc",
        skip: 0,
        take: 100,
      },
      async () => new Map(),
    );

    expect(page.ids).toEqual(["cdr-2"]);
    expect(seen[1]).toContain(AF_CATEGORY.conflict);
    expect(seen[1]).toContain(AF_STATUS.unknown);
    expect(seen[1]).toContain("COUNT(DISTINCT t.id)");
  });
});

describe("querySmgFacetValues", () => {
  it("reads a stored column from the CDR row when antifraud labels are still pending", async () => {
    const seen: string[] = [];
    const query = (async (sql: Prisma.Sql) => {
      seen.push(sqlText(sql));
      if (seen.length === 1) return [{ n: 1 }];
      return [
        {
          id: "cdr-1",
          value: "7495",
          category: AF_CATEGORY.noData,
          status: AF_STATUS.unknown,
          pending_trace: "trace-1",
        },
      ];
    }) as unknown as SqlQuery;

    const items = await querySmgFacetValues(
      query,
      {
        column: "incomingCgpn",
        month,
        device: "gw",
        phoneQ: "",
        filters: { antifraud: [AF_CATEGORY.passed] },
        q: "",
        limit: 10,
      },
      async () => new Map([["trace-1", { category: AF_CATEGORY.passed, status: AF_STATUS.firstTry }]]),
    );

    expect(items).toEqual([{ value: "7495", count: 1 }]);
    expect(seen[1]).toContain("smg_cdr_records.id");
    expect(seen[1]).toContain("incoming_cgpn");
  });

  it("leaves the date column's own selection out of the date menu", async () => {
    const seen: string[] = [];
    const query = (async (sql: Prisma.Sql) => {
      seen.push(sqlText(sql));
      if (seen.length === 1) return [{ n: 0 }];
      return [{ value: "2026-10-13", count: 2 }];
    }) as unknown as SqlQuery;

    const items = await querySmgFacetValues(
      query,
      {
        column: "setupDay",
        month,
        device: "gw",
        phoneQ: "",
        filters: { setupDay: ["2026-09-30"], antifraud: [AF_CATEGORY.passed] },
        q: "",
        limit: 10,
      },
      async () => new Map(),
    );

    expect(items).toEqual([{ value: "2026-10-13", count: 2 }]);
    expect(seen[1]).toContain(AF_CATEGORY.passed);
    expect(seen[1]).not.toContain("2026-09-30");
  });
});

type SqlQuery = <T>(sql: Prisma.Sql) => Promise<T>;
