/**
 * Counts and problem rows for one numbering summary. Reads do not lock catalogs.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ProviderMarks, SideMark } from "@/modules/mail/summary-marks";
import {
  MANUAL_SOURCE,
  localAsOf,
  scheduledAsOf,
  type ProblemRow,
  type SummaryLetterInput,
  type SummaryRow,
  type SummarySide,
} from "@/modules/mail/summary-letter";
import {
  geographyMatchKeySql,
  PSTN_ELEVEN_DIGIT,
  PSTN_TEN_DIGIT,
} from "@/modules/rtu/sql";

type CountRow = { provider: string; count: number };
type SnapRow = { provider: string; side: string; count: number; asOf: Date };
type ProblemSql = {
  provider: string;
  side: string;
  abc: string;
  local: string;
  city: string;
  region: string;
  problem: string;
};

const MATCH = geographyMatchKeySql(Prisma.sql`number`);

function asCount(value: number | null | undefined): number {
  return Number(value ?? 0);
}

function previousDate(rows: SnapRow[]): string | null {
  if (rows.length === 0) return null;
  const latest = rows.reduce(
    (max, row) => (row.asOf > max ? row.asOf : max),
    rows[0]?.asOf ?? new Date(0),
  );
  return latest.toISOString().slice(0, 10);
}

function snapCount(rows: SnapRow[], provider: string, side: SummarySide): number | null {
  const found = rows.find((row) => row.provider === provider && row.side === side);
  return found ? found.count : null;
}

function visible(
  state: SideMark | null,
  count: number,
  previous: number | null,
): boolean {
  if (state === "ok" || state === "error") return true;
  return count > 0 || previous != null;
}

function sideRows(
  side: SummarySide,
  marks: ProviderMarks[],
  counts: Map<string, number>,
  snaps: SnapRow[],
): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const mark of marks) {
    const state = side === "free" ? mark.free : mark.purchased;
    const count = counts.get(mark.provider) ?? 0;
    const previous = snapCount(snaps, mark.provider, side);
    if (!visible(state, count, previous)) continue;
    const error = state === "error";
    rows.push({
      provider: mark.provider,
      count: error ? null : count,
      previous,
      at:
        error || state === "ok"
          ? side === "free"
            ? mark.freeAt
            : mark.purchasedAt
          : null,
      error,
      dateOnly: false,
    });
  }
  return rows;
}

async function counts(
  table: "free_numbers" | "purchased_numbers",
): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT btrim(provider) AS provider, count(*)::int AS count
    FROM ${Prisma.raw(table)}
    GROUP BY btrim(provider)
  `;
  return new Map(rows.map((row) => [row.provider, asCount(row.count)]));
}

async function total(table: "free_numbers" | "purchased_numbers"): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM ${Prisma.raw(table)}
  `;
  return asCount(rows[0]?.count);
}

async function manualCount(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    WITH endpoints AS (
      SELECT btrim(e."endpointNumber") AS number
      FROM phone_endpoints e
      WHERE e."endpointNumber" IS NOT NULL AND btrim(e."endpointNumber") <> ''
    ),
    endpoint_keys AS (
      SELECT number, ${MATCH} AS match_key FROM endpoints
    ),
    purchased_keys AS (
      SELECT ${geographyMatchKeySql(Prisma.sql`e164`)} AS match_key
      FROM purchased_numbers
      WHERE btrim(e164) <> ''
    )
    SELECT count(*)::int AS count
    FROM endpoint_keys e
    WHERE NOT EXISTS (
      SELECT 1 FROM purchased_keys p WHERE p.match_key = e.match_key
    )
  `;
  return asCount(rows[0]?.count);
}

async function catalogProblems(
  table: "free_numbers" | "purchased_numbers",
  side: SummarySide,
): Promise<{
  count: number;
  rows: ProblemRow[];
}> {
  const missing =
    side === "purchased"
      ? Prisma.sql`
          OR NOT EXISTS (
            SELECT 1
            FROM phone_endpoints e
            WHERE e."endpointNumber" IS NOT NULL
              AND btrim(e."endpointNumber") <> ''
              AND ${geographyMatchKeySql(Prisma.sql`btrim(e."endpointNumber")`)}
                = ${geographyMatchKeySql(Prisma.sql`n.e164`)}
          )`
      : Prisma.empty;
  const problem = Prisma.sql`
    CASE
      WHEN ${
        side === "purchased"
          ? Prisma.sql`NOT EXISTS (
        SELECT 1
        FROM phone_endpoints e
        WHERE e."endpointNumber" IS NOT NULL
          AND btrim(e."endpointNumber") <> ''
          AND ${geographyMatchKeySql(Prisma.sql`btrim(e."endpointNumber")`)}
            = ${geographyMatchKeySql(Prisma.sql`n.e164`)}
      )`
          : Prisma.sql`FALSE`
      } THEN 'rtu'
      WHEN btrim(n.mask) = '' OR btrim(n."maskType") = '' THEN 'mask'
      WHEN n.pstn_hits IN (0, 2) THEN 'pstn'
      ELSE NULL
    END
  `;
  const where = Prisma.sql`
    btrim(n.mask) = '' OR btrim(n."maskType") = '' OR n.pstn_hits IN (0, 2) ${missing}
  `;
  const relation = Prisma.raw(table);
  const counted = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM ${relation} n
    WHERE ${where}
  `;
  const listed = await prisma.$queryRaw<ProblemSql[]>`
    SELECT
      btrim(n.provider) AS provider,
      ${side} AS side,
      n.abc AS abc,
      n."number" AS local,
      n.city AS city,
      n.region AS region,
      ${problem} AS problem
    FROM ${relation} n
    WHERE ${where}
    ORDER BY provider, n.e164
    LIMIT 100
  `;
  return {
    count: asCount(counted[0]?.count),
    rows: listed.flatMap((row) => {
      if (row.problem !== "mask" && row.problem !== "pstn" && row.problem !== "rtu")
        return [];
      return [
        {
          provider: row.provider,
          side,
          abc: row.abc,
          number: row.local,
          city: row.city,
          region: row.region,
          problem: row.problem,
        },
      ];
    }),
  };
}

async function manualProblems(): Promise<{ count: number; rows: ProblemRow[] }> {
  const digits = Prisma.sql`regexp_replace(s.number, '[^0-9]', '', 'g')`;
  const key = Prisma.sql`(
    CASE
      WHEN ${digits} ~ ${PSTN_ELEVEN_DIGIT} THEN substring(${digits} FROM 2)
      WHEN ${digits} ~ ${PSTN_TEN_DIGIT} THEN ${digits}
      ELSE NULL
    END
  )`;
  const problem = Prisma.sql`
    CASE
      WHEN btrim(s.mask) = '' OR btrim(s."maskType") = '' THEN 'mask'
      WHEN c.phone IS NULL OR c.found IS NOT TRUE OR c.operator IS NULL OR btrim(c.operator) = '' THEN 'pstn'
      ELSE NULL
    END
  `;
  const where = Prisma.sql`${problem} IS NOT NULL`;
  const from = Prisma.sql`
    FROM rtu_screen s
    LEFT JOIN pstn_phone_cache c ON c.phone = ${key}
    WHERE s.missing = false
      AND s.source = ${MANUAL_SOURCE}
      AND ${where}
  `;
  const counted = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count ${from}
  `;
  const listed = await prisma.$queryRaw<ProblemSql[]>`
    SELECT
      ${MANUAL_SOURCE} AS provider,
      'purchased' AS side,
      s.abc AS abc,
      s.telephone AS local,
      s.city AS city,
      s.region AS region,
      ${problem} AS problem
    ${from}
    ORDER BY s.abc, s.telephone
    LIMIT 100
  `;
  return {
    count: asCount(counted[0]?.count),
    rows: listed.flatMap((row) => {
      if (row.problem !== "mask" && row.problem !== "pstn") return [];
      return [
        {
          provider: MANUAL_SOURCE,
          side: "purchased" as const,
          abc: row.abc,
          number: row.local,
          city: row.city,
          region: row.region,
          problem: row.problem,
        },
      ];
    }),
  };
}

export async function composeNumberingSummary(input: {
  marks: ProviderMarks[];
  startedAt: Date;
  scheduled: boolean;
  timeZone: string;
}): Promise<SummaryLetterInput> {
  const asOf = input.scheduled
    ? scheduledAsOf(input.startedAt, input.timeZone)
    : localAsOf(input.startedAt, input.timeZone);
  const [
    freeCounts,
    purchasedCounts,
    freeTotal,
    purchasedCatalog,
    manual,
    freeProblems,
    purchasedProblems,
    handProblems,
    snaps,
  ] = await Promise.all([
    counts("free_numbers"),
    counts("purchased_numbers"),
    total("free_numbers"),
    total("purchased_numbers"),
    manualCount(),
    catalogProblems("free_numbers", "free"),
    catalogProblems("purchased_numbers", "purchased"),
    manualProblems(),
    prisma.numberingLoadSnapshot.findMany(),
  ]);
  const previous = snaps.map((row) => ({
    provider: row.provider,
    side: row.side,
    count: row.count,
    asOf: row.asOf,
  }));
  const freeRows = sideRows("free", input.marks, freeCounts, previous);
  const purchasedRows = sideRows("purchased", input.marks, purchasedCounts, previous);
  purchasedRows.push({
    provider: MANUAL_SOURCE,
    count: manual,
    previous: snapCount(previous, MANUAL_SOURCE, "purchased"),
    at: input.startedAt.getTime(),
    error: false,
    dateOnly: true,
  });
  const problems = [...freeProblems.rows, ...purchasedProblems.rows, ...handProblems.rows]
    .sort(
      (a, b) =>
        a.provider.localeCompare(b.provider, "ru") ||
        a.number.localeCompare(b.number, "ru"),
    )
    .slice(0, 100);
  const asOfDate = new Date(`${asOf}T00:00:00.000Z`);
  const writes: {
    provider: string;
    side: SummarySide;
    count: number;
    at: number | null;
  }[] = [];
  for (const mark of input.marks) {
    if (mark.free === "ok") {
      writes.push({
        provider: mark.provider,
        side: "free",
        count: freeCounts.get(mark.provider) ?? 0,
        at: mark.freeAt,
      });
    }
    if (mark.purchased === "ok") {
      writes.push({
        provider: mark.provider,
        side: "purchased",
        count: purchasedCounts.get(mark.provider) ?? 0,
        at: mark.purchasedAt,
      });
    }
  }
  writes.push({
    provider: MANUAL_SOURCE,
    side: "purchased",
    count: manual,
    at: input.startedAt.getTime(),
  });
  await prisma.$transaction(
    writes.map((row) =>
      prisma.numberingLoadSnapshot.upsert({
        where: { provider_side: { provider: row.provider, side: row.side } },
        create: {
          provider: row.provider,
          side: row.side,
          count: row.count,
          asOf: asOfDate,
          loadedAt: row.at == null ? null : new Date(row.at),
        },
        update: {
          count: row.count,
          asOf: asOfDate,
          loadedAt: row.at == null ? null : new Date(row.at),
        },
      }),
    ),
  );
  return {
    asOf,
    previousAsOf: previousDate(previous),
    timeZone: input.timeZone,
    freeTotal,
    freeErrors: freeProblems.count,
    purchasedTotal: purchasedCatalog + manual,
    purchasedErrors: purchasedProblems.count + handProblems.count,
    freeRows,
    purchasedRows,
    problems,
    problemTotal: freeProblems.count + purchasedProblems.count + handProblems.count,
  };
}
