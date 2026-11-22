/**
 * Counts and problem rows for one numbering summary. Reads do not lock catalogs.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ProviderMarks, SideMark } from "@/modules/mail/summary-marks";
import {
  MANUAL_SOURCE,
  PROBLEM_LIMIT,
  compareProblemRows,
  localAsOf,
  scheduledAsOf,
  type ProblemRow,
  type ProblemSection,
  type SummaryLetterInput,
  type SummaryRow,
  type SummarySide,
} from "@/modules/mail/summary-letter";
import {
  matchE164Sql,
  pstnHitLateral,
  pstnMissSql,
} from "@/modules/numbering-catalog/pstn-hit-sql";
import { geographyMatchKeySql } from "@/modules/rtu/sql";

type CountRow = { provider: string; count: number };
type SnapRow = { provider: string; side: string; count: number; asOf: Date };
type ProblemSql = {
  provider: string;
  side: string;
  full: string;
  abc: string;
  local: string;
  city: string;
  region: string;
  problem: string;
};

/** A found mask is a resolved row. An empty type is not an error. */
function maskMissing(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`btrim(${column}) = ''`;
}

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
  errors: Map<string, number>,
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
      errors: errors.get(mark.provider) ?? 0,
    });
  }
  return rows;
}

function mapProblem(row: ProblemSql, side: ProblemSection): ProblemRow | null {
  if (row.problem !== "mask" && row.problem !== "pstn" && row.problem !== "rtu")
    return null;
  return {
    provider: row.provider,
    side,
    full: row.full,
    abc: row.abc,
    number: row.local,
    city: row.city,
    region: row.region,
    problem: row.problem,
  };
}

function addCounts(
  into: Map<string, number>,
  from: Map<string, number>,
): void {
  for (const [provider, count] of from) {
    into.set(provider, (into.get(provider) ?? 0) + count);
  }
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

async function freeMaskProblems(): Promise<{
  count: number;
  byProvider: Map<string, number>;
  rows: ProblemRow[];
}> {
  const where = maskMissing(Prisma.sql`n.mask`);
  const grouped = await prisma.$queryRaw<CountRow[]>`
    SELECT btrim(n.provider) AS provider, count(*)::int AS count
    FROM free_numbers n
    WHERE ${where}
    GROUP BY btrim(n.provider)
  `;
  const byProvider = new Map(grouped.map((row) => [row.provider, asCount(row.count)]));
  let count = 0;
  for (const value of byProvider.values()) count += value;
  const listed = await prisma.$queryRaw<ProblemSql[]>`
    SELECT
      btrim(n.provider) AS provider,
      'free' AS side,
      n.e164 AS full,
      n.abc AS abc,
      n."number" AS local,
      n.city AS city,
      n.region AS region,
      'mask' AS problem
    FROM free_numbers n
    WHERE ${where}
    ORDER BY n.e164
    LIMIT ${PROBLEM_LIMIT}
  `;
  return {
    count,
    byProvider,
    rows: listed.flatMap((row) => {
      const mapped = mapProblem(row, "free");
      return mapped ? [mapped] : [];
    }),
  };
}

/** Free rows still in the catalog with no unique PSTN hit (purge pending or empty snapshot). */
async function freeInCatalogPstn(): Promise<{
  count: number;
  byProvider: Map<string, number>;
  rows: ProblemRow[];
}> {
  const where = Prisma.sql`n.pstn_hits IN (0, 2)`;
  const grouped = await prisma.$queryRaw<CountRow[]>`
    SELECT btrim(n.provider) AS provider, count(*)::int AS count
    FROM free_numbers n
    WHERE ${where}
    GROUP BY btrim(n.provider)
  `;
  const byProvider = new Map(grouped.map((row) => [row.provider, asCount(row.count)]));
  let count = 0;
  for (const value of byProvider.values()) count += value;
  const listed = await prisma.$queryRaw<ProblemSql[]>`
    SELECT
      btrim(n.provider) AS provider,
      'excluded' AS side,
      n.e164 AS full,
      n.abc AS abc,
      n."number" AS local,
      n.city AS city,
      n.region AS region,
      'pstn' AS problem
    FROM free_numbers n
    WHERE ${where}
    ORDER BY n.e164
    LIMIT ${PROBLEM_LIMIT}
  `;
  return {
    count,
    byProvider,
    rows: listed.flatMap((row) => {
      const mapped = mapProblem(row, "excluded");
      return mapped ? [mapped] : [];
    }),
  };
}

async function freeExcludedArchive(
  okProviders: ReadonlySet<string>,
): Promise<{
  count: number;
  byProvider: Map<string, number>;
  rows: ProblemRow[];
}> {
  if (okProviders.size === 0) {
    return { count: 0, byProvider: new Map(), rows: [] };
  }
  const providers = [...okProviders];
  const grouped = await prisma.$queryRaw<CountRow[]>`
    SELECT btrim(e.provider) AS provider, count(*)::int AS count
    FROM numbering_free_pstn_excluded e
    WHERE btrim(e.provider) IN (${Prisma.join(providers)})
    GROUP BY btrim(e.provider)
  `;
  const byProvider = new Map(grouped.map((row) => [row.provider, asCount(row.count)]));
  let count = 0;
  for (const value of byProvider.values()) count += value;
  const listed = await prisma.$queryRaw<ProblemSql[]>`
    SELECT
      btrim(e.provider) AS provider,
      'excluded' AS side,
      e.e164 AS full,
      e.abc AS abc,
      e."number" AS local,
      e.city AS city,
      e.region AS region,
      'pstn' AS problem
    FROM numbering_free_pstn_excluded e
    WHERE btrim(e.provider) IN (${Prisma.join(providers)})
    ORDER BY e.e164
    LIMIT ${PROBLEM_LIMIT}
  `;
  return {
    count,
    byProvider,
    rows: listed.flatMap((row) => {
      const mapped = mapProblem(row, "excluded");
      return mapped ? [mapped] : [];
    }),
  };
}

async function purchasedProblems(): Promise<{
  count: number;
  byProvider: Map<string, number>;
  rows: ProblemRow[];
}> {
  const missing = Prisma.sql`
    OR NOT EXISTS (
      SELECT 1
      FROM phone_endpoints e
      WHERE e."endpointNumber" IS NOT NULL
        AND btrim(e."endpointNumber") <> ''
        AND ${geographyMatchKeySql(Prisma.sql`btrim(e."endpointNumber")`)}
          = ${geographyMatchKeySql(Prisma.sql`n.e164`)}
    )
  `;
  const problem = Prisma.sql`
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM phone_endpoints e
        WHERE e."endpointNumber" IS NOT NULL
          AND btrim(e."endpointNumber") <> ''
          AND ${geographyMatchKeySql(Prisma.sql`btrim(e."endpointNumber")`)}
            = ${geographyMatchKeySql(Prisma.sql`n.e164`)}
      ) THEN 'rtu'
      WHEN ${maskMissing(Prisma.sql`n.mask`)} THEN 'mask'
      WHEN n.pstn_hits IN (0, 2) THEN 'pstn'
      ELSE NULL
    END
  `;
  const where = Prisma.sql`
    ${maskMissing(Prisma.sql`n.mask`)} OR n.pstn_hits IN (0, 2) ${missing}
  `;
  const grouped = await prisma.$queryRaw<CountRow[]>`
    SELECT btrim(n.provider) AS provider, count(*)::int AS count
    FROM purchased_numbers n
    WHERE ${where}
    GROUP BY btrim(n.provider)
  `;
  const byProvider = new Map(grouped.map((row) => [row.provider, asCount(row.count)]));
  let count = 0;
  for (const value of byProvider.values()) count += value;
  const listed = await prisma.$queryRaw<ProblemSql[]>`
    SELECT
      btrim(n.provider) AS provider,
      'purchased' AS side,
      n.e164 AS full,
      n.abc AS abc,
      n."number" AS local,
      n.city AS city,
      n.region AS region,
      ${problem} AS problem
    FROM purchased_numbers n
    WHERE ${where}
    ORDER BY n.e164
    LIMIT ${PROBLEM_LIMIT}
  `;
  return {
    count,
    byProvider,
    rows: listed.flatMap((row) => {
      const mapped = mapProblem(row, "purchased");
      return mapped ? [mapped] : [];
    }),
  };
}

/**
 * Manual «Вручную» problems use the same PSTN range snapshot as catalog
 * decorate. The RTU screen operator column still reads pstn_phone_cache.
 */
async function manualProblems(): Promise<{ count: number; rows: ProblemRow[] }> {
  const e164 = matchE164Sql(Prisma.sql`s.number`);
  const problem = Prisma.sql`
    CASE
      WHEN ${maskMissing(Prisma.sql`s.mask`)} THEN 'mask'
      WHEN ${pstnMissSql(e164)} THEN 'pstn'
      ELSE NULL
    END
  `;
  const where = Prisma.sql`${problem} IS NOT NULL`;
  const from = Prisma.sql`
    FROM rtu_screen s
    ${pstnHitLateral(e164)}
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
      s.number AS full,
      s.abc AS abc,
      s.telephone AS local,
      s.city AS city,
      s.region AS region,
      ${problem} AS problem
    ${from}
    ORDER BY s.number
    LIMIT ${PROBLEM_LIMIT}
  `;
  return {
    count: asCount(counted[0]?.count),
    rows: listed.flatMap((row) => {
      const mapped = mapProblem(row, "purchased");
      return mapped ? [mapped] : [];
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
  const okFree = new Set(
    input.marks.filter((mark) => mark.free === "ok").map((mark) => mark.provider),
  );
  const [
    freeCounts,
    purchasedCounts,
    freeTotal,
    purchasedCatalog,
    manual,
    freeMask,
    freePstnLive,
    freeExcluded,
    boughtProblems,
    handProblems,
    snaps,
  ] = await Promise.all([
    counts("free_numbers"),
    counts("purchased_numbers"),
    total("free_numbers"),
    total("purchased_numbers"),
    manualCount(),
    freeMaskProblems(),
    freeInCatalogPstn(),
    freeExcludedArchive(okFree),
    purchasedProblems(),
    manualProblems(),
    prisma.numberingLoadSnapshot.findMany(),
  ]);
  const previous = snaps.map((row) => ({
    provider: row.provider,
    side: row.side,
    count: row.count,
    asOf: row.asOf,
  }));
  const freeErrorsByProvider = new Map(freeMask.byProvider);
  addCounts(freeErrorsByProvider, freePstnLive.byProvider);
  addCounts(freeErrorsByProvider, freeExcluded.byProvider);
  const freeRows = sideRows(
    "free",
    input.marks,
    freeCounts,
    previous,
    freeErrorsByProvider,
  );
  const purchasedErrorsByProvider = new Map(boughtProblems.byProvider);
  purchasedErrorsByProvider.set(
    MANUAL_SOURCE,
    (purchasedErrorsByProvider.get(MANUAL_SOURCE) ?? 0) + handProblems.count,
  );
  const purchasedRows = sideRows(
    "purchased",
    input.marks,
    purchasedCounts,
    previous,
    purchasedErrorsByProvider,
  );
  purchasedRows.push({
    provider: MANUAL_SOURCE,
    count: manual,
    previous: snapCount(previous, MANUAL_SOURCE, "purchased"),
    at: input.startedAt.getTime(),
    error: false,
    dateOnly: true,
    errors: handProblems.count,
  });
  const excludedListed = [...freeExcluded.rows, ...freePstnLive.rows]
    .sort(compareProblemRows)
    .slice(0, PROBLEM_LIMIT);
  const freeListed = freeMask.rows.slice().sort(compareProblemRows).slice(0, PROBLEM_LIMIT);
  const purchasedListed = [...boughtProblems.rows, ...handProblems.rows]
    .sort(compareProblemRows)
    .slice(0, PROBLEM_LIMIT);
  const excludedTotal = freeExcluded.count + freePstnLive.count;
  const freeProblemTotal = freeMask.count;
  const purchasedProblemTotal = boughtProblems.count + handProblems.count;
  const freeErrors = freeMask.count + freePstnLive.count + freeExcluded.count;
  const problems = [...excludedListed, ...freeListed, ...purchasedListed];
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
    freeErrors,
    purchasedTotal: purchasedCatalog + manual,
    purchasedErrors: purchasedProblemTotal,
    freeRows,
    purchasedRows,
    problems,
    excludedTotal,
    freeProblemTotal,
    purchasedProblemTotal,
    problemTotal: excludedTotal + freeProblemTotal + purchasedProblemTotal,
  };
}
