import { Prisma } from "@/generated/prisma/client";
import { cdrMonthPrefix } from "@/lib/month-window";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import {
  PARKING_DST,
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
  const srcSip = startsWithAnySql(src, SIP_TRUNK_PREFIXES);
  const parking = Prisma.sql`((${srcSip}) AND dst_name = ${PARKING_DST})`;
  const phantom = Prisma.sql`(
    ${parking}
    AND side_a = ${MISSING_BILLING_LABEL}
    AND side_b = ${MISSING_BILLING_LABEL}
  )`;

  return Prisma.sql`
    WITH month_calls AS (
      SELECT
        src_name,
        dst_name,
        side_a,
        side_b,
        ${billableMinutesSql()} AS minutes
      FROM cdr_records
      WHERE cdr_day LIKE ${statsMonthDayPrefix(year, month)}
    ),
    legs AS (
      SELECT
        src_name AS device,
        'in'::text AS dir,
        minutes,
        CASE WHEN ${parking} THEN 1 ELSE 0 END AS parking,
        CASE WHEN ${phantom} THEN 1 ELSE 0 END AS phantom
      FROM month_calls
      WHERE ${srcMatch}
      UNION ALL
      SELECT
        dst_name AS device,
        'out'::text AS dir,
        minutes,
        0 AS parking,
        0 AS phantom
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
      SUM(CASE WHEN dir = 'out' THEN minutes ELSE 0 END)::bigint AS out_minutes,
      SUM(parking)::int AS parking_calls,
      SUM(CASE WHEN parking = 1 THEN minutes ELSE 0 END)::bigint AS parking_minutes,
      SUM(phantom)::int AS phantom_calls,
      SUM(CASE WHEN phantom = 1 THEN minutes ELSE 0 END)::bigint AS phantom_minutes
    FROM legs
    GROUP BY 1, 2
    ORDER BY 2 ASC
  `;
}
