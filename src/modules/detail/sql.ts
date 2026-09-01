import { Prisma } from "@/generated/prisma/client";
import { cdrMonthPrefix } from "@/lib/month-window";
import {
  DETAIL_LDC_SUFFIX,
  DETAIL_LOCAL_SUFFIX,
  DETAIL_OLD_SUFFIX,
  DETAIL_PSTN_PREFIX,
  DETAIL_TRUNK_PREFIX,
  PARKING_DST,
} from "@/modules/detail/classify";
import { billableMinutesSql } from "@/modules/traffic/billable-minutes-sql";

export function detailMonthDayPrefix(year: number, month: number): string {
  return `${cdrMonthPrefix(year, month)}%`;
}

export function clientMonthStatsSql(year: number, month: number): Prisma.Sql {
  const dst = Prisma.sql`dst_name`;
  const pstnLocal = Prisma.sql`(starts_with(${dst}, ${DETAIL_PSTN_PREFIX}) AND right(${dst}, 6) = ${DETAIL_LOCAL_SUFFIX})`;
  const trunk = Prisma.sql`starts_with(${dst}, ${DETAIL_TRUNK_PREFIX})`;
  const pstnLdcOrOld = Prisma.sql`(starts_with(${dst}, ${DETAIL_PSTN_PREFIX}) AND (right(${dst}, 4) = ${DETAIL_LDC_SUFFIX} OR right(${dst}, 4) = ${DETAIL_OLD_SUFFIX}))`;
  const outgoingMatch = Prisma.sql`((${pstnLocal}) OR (${trunk}) OR (${pstnLdcOrOld}))`;

  return Prisma.sql`
    WITH clients AS MATERIALIZED (
      SELECT DISTINCT ON (phone)
        phone,
        client
      FROM (
        SELECT
          TRIM("endpointNumber") AS phone,
          TRIM(data->>'Описание') AS client,
          name
        FROM phone_endpoints
        WHERE "endpointNumber" IS NOT NULL
          AND TRIM("endpointNumber") <> ''
          AND NULLIF(TRIM(data->>'Описание'), '') IS NOT NULL
      ) catalog
      ORDER BY phone, name
    ),
    month_calls AS MATERIALIZED (
      SELECT
        TRIM(bill_ani) AS ani,
        TRIM(bill_dnis) AS dnis,
        dst_name,
        ${billableMinutesSql()} AS minutes
      FROM cdr_records
      WHERE cdr_day LIKE ${detailMonthDayPrefix(year, month)}
        AND (
          TRIM(bill_ani) IN (SELECT phone FROM clients)
          OR TRIM(bill_dnis) IN (SELECT phone FROM clients)
        )
    ),
    legs AS (
      SELECT
        cb.client,
        minutes,
        1 AS in_c,
        CASE WHEN dst_name = ${PARKING_DST} THEN 1 ELSE 0 END AS park_c,
        0 AS local_c,
        0 AS trunk_c,
        0 AS ldc_c
      FROM month_calls m
      JOIN clients cb ON cb.phone = m.dnis
      UNION ALL
      SELECT
        ca.client,
        minutes,
        0,
        0,
        CASE WHEN ${pstnLocal} THEN 1 ELSE 0 END,
        CASE WHEN ${trunk} THEN 1 ELSE 0 END,
        CASE WHEN ${pstnLdcOrOld} THEN 1 ELSE 0 END
      FROM month_calls m
      JOIN clients ca ON ca.phone = m.ani
      WHERE ${outgoingMatch}
    )
    SELECT
      client,
      SUM(in_c)::int AS in_calls,
      SUM(in_c * minutes)::bigint AS in_minutes,
      SUM(local_c)::int AS out_calls,
      SUM(local_c * minutes)::bigint AS out_minutes,
      SUM(park_c)::int AS parking_calls,
      SUM(park_c * minutes)::bigint AS parking_minutes,
      SUM(trunk_c)::int AS external_calls,
      SUM(trunk_c * minutes)::bigint AS external_minutes,
      SUM(ldc_c)::int AS ldc_calls,
      SUM(ldc_c * minutes)::bigint AS ldc_minutes
    FROM legs
    GROUP BY client
  `;
}
