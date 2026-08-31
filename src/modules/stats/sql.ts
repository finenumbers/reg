import { Prisma } from "@/generated/prisma/client";
import { cdrMonthPrefix } from "@/lib/month-window";
import {
  SIP_TRUNK_PREFIXES,
  STATS_DEVICE_PREFIXES,
} from "@/modules/stats/classify";
import { billableMinutesSql } from "@/modules/traffic/billable-minutes-sql";

function startsWithAnySql(
  column: Prisma.Sql,
  prefixes: readonly string[],
): Prisma.Sql {
  return Prisma.join(
    prefixes.map((prefix) => Prisma.sql`starts_with(${column}, ${prefix})`),
    " OR ",
  );
}

export function statsMonthDayPrefix(year: number, month: number): string {
  return `${cdrMonthPrefix(year, month)}%`;
}

export function deviceMonthStatsSql(year: number, month: number): Prisma.Sql {
  const src = Prisma.sql`src_name`;
  const dst = Prisma.sql`dst_name`;
  const device = Prisma.sql`device`;
  const srcMatch = startsWithAnySql(src, STATS_DEVICE_PREFIXES);
  const dstMatch = startsWithAnySql(dst, STATS_DEVICE_PREFIXES);
  const sipMatch = startsWithAnySql(device, SIP_TRUNK_PREFIXES);

  return Prisma.sql`
    WITH month_calls AS (
      SELECT
        src_name,
        dst_name,
        ${billableMinutesSql()} AS minutes
      FROM cdr_records
      WHERE cdr_day LIKE ${statsMonthDayPrefix(year, month)}
    ),
    legs AS (
      SELECT src_name AS device, 'in'::text AS dir, minutes
      FROM month_calls
      WHERE ${srcMatch}
      UNION ALL
      SELECT dst_name AS device, 'out'::text AS dir, minutes
      FROM month_calls
      WHERE ${dstMatch}
    )
    SELECT
      CASE
        WHEN ${sipMatch} THEN 'sip'
        ELSE 'platform'
      END AS kind,
      device,
      SUM(CASE WHEN dir = 'in' THEN 1 ELSE 0 END)::int AS in_calls,
      SUM(CASE WHEN dir = 'in' THEN minutes ELSE 0 END)::bigint AS in_minutes,
      SUM(CASE WHEN dir = 'out' THEN 1 ELSE 0 END)::int AS out_calls,
      SUM(CASE WHEN dir = 'out' THEN minutes ELSE 0 END)::bigint AS out_minutes
    FROM legs
    GROUP BY 1, 2
    ORDER BY 2 ASC
  `;
}
