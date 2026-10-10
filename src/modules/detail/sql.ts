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
import {
  CALL_CATEGORY,
  CALL_TYPE,
  ORIGINATOR_CAPACITY_DISCONNECT,
  TERMINATOR_CAPACITY_DISCONNECT,
} from "@/modules/traffic/call-class";

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
        tariff_charge,
        call_category,
        call_type,
        disconnect_code_string,
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
    ),
    charges AS (
      SELECT
        ca.client,
        ROUND(SUM(
          CASE
            WHEN btrim(m.tariff_charge) ~ '^-?[0-9]+([.][0-9]+)?$'
            THEN btrim(m.tariff_charge)::numeric
            ELSE 0
          END
        ) * 100)::bigint AS mgmn_kopecks
      FROM month_calls m
      JOIN clients ca ON ca.phone = m.ani
      GROUP BY ca.client
    ),
    legs_by_client AS (
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
    ),
    capacity AS (
      SELECT
        client,
        COUNT(*)::int AS capacity_calls
      FROM (
        SELECT ca.client
        FROM month_calls m
        JOIN clients ca ON ca.phone = m.ani
        WHERE m.call_category = ${CALL_CATEGORY.errors}
          AND m.call_type = ${CALL_TYPE.capacity}
          AND m.disconnect_code_string = ${ORIGINATOR_CAPACITY_DISCONNECT}
        UNION ALL
        SELECT cb.client
        FROM month_calls m
        JOIN clients cb ON cb.phone = m.dnis
        WHERE m.call_category = ${CALL_CATEGORY.errors}
          AND m.call_type = ${CALL_TYPE.capacity}
          AND m.disconnect_code_string = ${TERMINATOR_CAPACITY_DISCONNECT}
      ) hits
      GROUP BY client
    ),
    clients_present AS (
      SELECT client FROM legs_by_client
      UNION
      SELECT client FROM capacity
    )
    SELECT
      clients_present.client,
      COALESCE(legs_by_client.in_calls, 0)::int AS in_calls,
      COALESCE(legs_by_client.in_minutes, 0)::bigint AS in_minutes,
      COALESCE(legs_by_client.out_calls, 0)::int AS out_calls,
      COALESCE(legs_by_client.out_minutes, 0)::bigint AS out_minutes,
      COALESCE(legs_by_client.parking_calls, 0)::int AS parking_calls,
      COALESCE(legs_by_client.parking_minutes, 0)::bigint AS parking_minutes,
      COALESCE(legs_by_client.external_calls, 0)::int AS external_calls,
      COALESCE(legs_by_client.external_minutes, 0)::bigint AS external_minutes,
      COALESCE(legs_by_client.ldc_calls, 0)::int AS ldc_calls,
      COALESCE(legs_by_client.ldc_minutes, 0)::bigint AS ldc_minutes,
      COALESCE(charges.mgmn_kopecks, 0)::bigint AS mgmn_kopecks,
      COALESCE(capacity.capacity_calls, 0)::int AS capacity_calls
    FROM clients_present
    LEFT JOIN legs_by_client ON legs_by_client.client = clients_present.client
    LEFT JOIN charges ON charges.client = clients_present.client
    LEFT JOIN capacity ON capacity.client = clients_present.client
  `;
}
