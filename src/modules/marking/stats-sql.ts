/**
 * One month of OPRS calls, counted by marking client and «Сеть».
 * A call is one event, or two when the A-number has a non-empty MAV cell
 * for that network. The statement returns aggregates. Call rows stay in
 * the database.
 */

import { Prisma } from "@/generated/prisma/client";
import { cdrMonthDayRange } from "@/modules/traffic/cdr-month";
import { OPRS_EXTERNAL_NETWORK, OPRS_NETWORK_LABEL } from "@/modules/oprs/derived";
import {
  oprsBlockedProbeSql,
  oprsNetworkValueSql,
  oprsRecordPredicateSql,
} from "@/modules/oprs/filter-sql";
import { oprsNamesByTone, type OprsOperatorToneMap } from "@/modules/oprs/operator-tone";
import type { BlockedNumberIndex } from "@/modules/phones/blocked-numbers";
import { markingWorkingCte } from "@/modules/marking/sql";

function mavNonEmpty(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`NULLIF(btrim(COALESCE(${column}, '')), '') IS NOT NULL`;
}

/** One OPRS call is 1, or 2 when the matching MAV cell on the A-number is set. */
function callWeightSql(network: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(CASE
    WHEN ${network} = ${OPRS_NETWORK_LABEL.red} AND ${mavNonEmpty(Prisma.sql`w.mav_mts`)} THEN 2
    WHEN ${network} = ${OPRS_NETWORK_LABEL.green} AND ${mavNonEmpty(Prisma.sql`w.mav_megafon`)} THEN 2
    WHEN ${network} = ${OPRS_NETWORK_LABEL.yellow} AND ${mavNonEmpty(Prisma.sql`w.mav_beeline`)} THEN 2
    WHEN ${network} = ${OPRS_NETWORK_LABEL.gray} AND ${mavNonEmpty(Prisma.sql`w.mav_t2`)} THEN 2
    ELSE 1
  END)`;
}

export function markingStatsSql(input: {
  year: number;
  month: number;
  tones: OprsOperatorToneMap;
  blocked: BlockedNumberIndex;
}): Prisma.Sql {
  const range = cdrMonthDayRange(input.year, input.month);
  const probe = oprsBlockedProbeSql(input.blocked);
  const blocked = probe ? Prisma.sql`blk.blocked` : Prisma.sql`FALSE`;
  const network = oprsNetworkValueSql(oprsNamesByTone(input.tones), blocked, true);
  const weight = callWeightSql(network);
  const lateral = probe
    ? Prisma.sql`LEFT JOIN LATERAL (SELECT ${probe} AS blocked) blk ON TRUE`
    : Prisma.empty;
  return Prisma.sql`
    WITH ${markingWorkingCte()},
    roster AS MATERIALIZED (
      SELECT
        w.number,
        COALESCE(w.client, '') AS client,
        COALESCE(m."mavMts", '') AS mav_mts,
        COALESCE(m."mavMegafon", '') AS mav_megafon,
        COALESCE(m."mavBeeline", '') AS mav_beeline,
        COALESCE(m."mavT2", '') AS mav_t2
      FROM working w
      LEFT JOIN marking_rows m
        ON m."phoneNumber" = w.number
    ),
    clients AS (
      SELECT client, COUNT(*)::int AS numbers
      FROM roster
      GROUP BY client
    ),
    call_counts AS (
      SELECT w.client AS client, ${network} AS network, SUM(${weight})::bigint AS n
      FROM cdr_records c
      INNER JOIN roster w ON w.number = btrim(c.bill_ani)
      ${lateral}
      WHERE c.cdr_date >= ${range.start}
        AND c.cdr_date < ${range.end}
        AND ${oprsRecordPredicateSql()}
      GROUP BY 1, 2
    ),
    meta AS (
      SELECT
        (
          SELECT "catalogRevision"::int
          FROM rtu_screen_state
          WHERE id = 1
        ) AS catalog_revision,
        (
          SELECT "loadedAt"
          FROM marking_import_state
          WHERE id = 1
        ) AS loaded_at,
        (
          SELECT generation::int
          FROM marking_import_state
          WHERE id = 1
        ) AS import_generation
    )
    SELECT
      clients.client,
      clients.numbers,
      COALESCE(SUM(call_counts.n) FILTER (WHERE call_counts.network = ${OPRS_NETWORK_LABEL.red}), 0)::bigint AS mts,
      COALESCE(SUM(call_counts.n) FILTER (WHERE call_counts.network = ${OPRS_NETWORK_LABEL.green}), 0)::bigint AS megafon,
      COALESCE(SUM(call_counts.n) FILTER (WHERE call_counts.network = ${OPRS_NETWORK_LABEL.yellow}), 0)::bigint AS beeline,
      COALESCE(SUM(call_counts.n) FILTER (WHERE call_counts.network = ${OPRS_NETWORK_LABEL.gray}), 0)::bigint AS t2,
      COALESCE(SUM(call_counts.n) FILTER (WHERE call_counts.network = ${OPRS_EXTERNAL_NETWORK}), 0)::bigint AS external,
      meta.catalog_revision,
      meta.loaded_at,
      COALESCE(meta.import_generation, 0)::int AS import_generation
    FROM meta
    LEFT JOIN clients ON TRUE
    LEFT JOIN call_counts ON call_counts.client = clients.client
    GROUP BY clients.client, clients.numbers, meta.catalog_revision, meta.loaded_at, meta.import_generation
  `;
}
