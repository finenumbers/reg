/**
 * SQL for the dashboard call charts.
 * The phone series keeps the unfiltered concurrency sweep.
 * The other concurrency series add a stored-class predicate before duration expands.
 * Errors are a count of category rows in the minute of `cdrAt`, not an overlap.
 */

import { Prisma } from "@/generated/prisma/client";
import type { UtcCallWindow } from "@/modules/dashboard/concurrency";
import type { ConcurrencySeriesId } from "@/modules/dashboard/series";
import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";
import { elapsedMsNumericSql } from "@/modules/traffic/billable-minutes-sql";

/** Earlier edge of the day and the rolling two hours. */
export function errorScanStart(bounds: UtcCallWindow): Date {
  return new Date(Math.min(bounds.dayStart.getTime(), bounds.recentStart.getTime()));
}

export function concurrencyClassClause(series: ConcurrencySeriesId): Prisma.Sql {
  switch (series) {
    case "phone":
      return Prisma.empty;
    case "client":
      return Prisma.sql`AND (
        (call_category = ${CALL_CATEGORY.incoming} AND call_status = ${CALL_STATUS.success})
        OR (call_category = ${CALL_CATEGORY.outgoing} AND call_status = ${CALL_STATUS.success})
      )`;
    case "phantom":
      return Prisma.sql`AND call_category = ${CALL_CATEGORY.phantom}`;
    case "parking-in":
      return Prisma.sql`AND call_category = ${CALL_CATEGORY.incoming} AND call_status = ${CALL_STATUS.parking}`;
    case "parking-out":
      return Prisma.sql`AND call_category = ${CALL_CATEGORY.outgoing} AND call_status = ${CALL_STATUS.parking}`;
    default: {
      const unreachable: never = series;
      return unreachable;
    }
  }
}

export function concurrencyMinutesSql(
  bounds: UtcCallWindow,
  series: ConcurrencySeriesId,
): Prisma.Sql {
  const elapsed = elapsedMsNumericSql();
  const classClause = concurrencyClassClause(series);
  return Prisma.sql`
    WITH calls AS MATERIALIZED (
      SELECT
        "cdrAt" AS start_at,
        "cdrAt" + (LEAST(ms, 86400000) * INTERVAL '1 millisecond') AS end_at
      FROM (
        SELECT "cdrAt", ${elapsed} AS ms
        FROM cdr_records
        WHERE "cdrAt" >= ${bounds.scanStart}
          AND "cdrAt" < ${bounds.dayEnd}
          ${classClause}
      ) src
      WHERE ms > 0
    ),
    events AS MATERIALIZED (
      SELECT start_at AS ts, 1 AS delta FROM calls
      UNION ALL
      SELECT end_at AS ts, -1 AS delta FROM calls
    ),
    running AS (
      SELECT
        ts,
        delta,
        sum(delta) OVER (
          ORDER BY ts ASC, delta ASC
          ROWS UNBOUNDED PRECEDING
        )::int AS level
      FROM events
      WHERE ts < ${bounds.seriesEnd}
    ),
    day_minutes AS (
      SELECT
        floor(extract(epoch FROM ts) / 60)::int AS minute_key,
        max(level)::int AS peak,
        (array_agg(level ORDER BY ts DESC, delta DESC))[1]::int AS level_at_end,
        bool_or(
          extract(epoch FROM ts) - floor(extract(epoch FROM ts) / 60) * 60 < 0.0005
        ) AS touches_start
      FROM running
      WHERE ts >= ${bounds.dayStart}
      GROUP BY 1
    ),
    recent_minutes AS (
      SELECT
        floor(extract(epoch FROM ts) / 60)::int AS minute_key,
        max(level)::int AS peak,
        (array_agg(level ORDER BY ts DESC, delta DESC))[1]::int AS level_at_end,
        bool_or(
          extract(epoch FROM ts) - floor(extract(epoch FROM ts) / 60) * 60 < 0.0005
        ) AS touches_start
      FROM running
      WHERE ts >= ${bounds.recentStart}
      GROUP BY 1
    )
    SELECT
      (
        SELECT coalesce(sum(delta), 0)::int
        FROM events
        WHERE ts < ${bounds.dayStart}
      ) AS day_carry,
      (
        SELECT coalesce(sum(delta), 0)::int
        FROM events
        WHERE ts < ${bounds.recentStart}
      ) AS recent_carry,
      (
        SELECT coalesce(
          json_agg(
            json_build_object(
              'minuteKey', minute_key,
              'peak', peak,
              'levelAtEnd', level_at_end,
              'touchesStart', touches_start
            )
          ),
          '[]'::json
        )
        FROM day_minutes
      ) AS day_minutes,
      (
        SELECT coalesce(
          json_agg(
            json_build_object(
              'minuteKey', minute_key,
              'peak', peak,
              'levelAtEnd', level_at_end,
              'touchesStart', touches_start
            )
          ),
          '[]'::json
        )
        FROM recent_minutes
      ) AS recent_minutes
  `;
}

export function errorMinutesSql(bounds: UtcCallWindow): Prisma.Sql {
  return Prisma.sql`
    SELECT
      floor(extract(epoch FROM "cdrAt") / 60)::int AS minute_key,
      count(*) FILTER (WHERE "cdrAt" >= ${bounds.dayStart})::int AS day_n,
      count(*) FILTER (WHERE "cdrAt" >= ${bounds.recentStart})::int AS recent_n
    FROM cdr_records
    WHERE "cdrAt" >= ${errorScanStart(bounds)}
      AND "cdrAt" < ${bounds.seriesEnd}
      AND call_category = ${CALL_CATEGORY.errors}
    GROUP BY 1
  `;
}
