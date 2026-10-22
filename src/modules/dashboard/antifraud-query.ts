/**
 * SQL for the antifraud dashboard charts.
 * Minutes are floor(extract(epoch)/60) of a UTC instant, never date_trunc.
 * Answers and delay read setup_time in the node's CDR zone. Timeout reads logged_at.
 */

import { Prisma } from "@/generated/prisma/client";
import { errorScanStart } from "@/modules/dashboard/call-query";
import { widenedSetupBounds } from "@/modules/dashboard/antifraud-series";
import type { UtcCallWindow } from "@/modules/dashboard/concurrency";
import { CDR_DATE_CIVIL_REGEX } from "@/modules/traffic/cdr-date-parts";

function atZone(zone: string): Prisma.Sql {
  return Prisma.sql`make_timestamptz(
    substring(btrim(c.setup_time) from 1 for 4)::int,
    substring(btrim(c.setup_time) from 6 for 2)::int,
    substring(btrim(c.setup_time) from 9 for 2)::int,
    substring(btrim(c.setup_time) from 12 for 2)::int,
    substring(btrim(c.setup_time) from 15 for 2)::int,
    substring(btrim(c.setup_time) from 18 for 2)::int,
    ${zone}
  )`;
}

function zonedInstant(): Prisma.Sql {
  return Prisma.sql`CASE n.cdr_timezone
    WHEN ${"UTC"} THEN ${atZone("UTC")}
    WHEN ${"Europe/Kaliningrad"} THEN ${atZone("Europe/Kaliningrad")}
    WHEN ${"Europe/Moscow"} THEN ${atZone("Europe/Moscow")}
    WHEN ${"Asia/Novosibirsk"} THEN ${atZone("Asia/Novosibirsk")}
    ELSE NULL
  END`;
}

function zonedFrom(bounds: UtcCallWindow): Prisma.Sql {
  const window = widenedSetupBounds(bounds);
  return Prisma.sql`
    FROM smg_cdr_records c
    INNER JOIN smg_syslog_nodes n
      ON n.identifier IS NOT NULL
     AND n.identifier <> ''
     AND n.identifier = lower(btrim(c.device_sign))
     AND n.antifraud_enabled
    WHERE c.setup_time >= ${window.start}
      AND c.setup_time < ${window.end}
      AND btrim(c.setup_time) ~ ${CDR_DATE_CIVIL_REGEX}
  `;
}

export function answerMinutesSql(bounds: UtcCallWindow): Prisma.Sql {
  const scan = errorScanStart(bounds);
  return Prisma.sql`
    WITH zoned AS (
      SELECT
        c.af_category,
        ${zonedInstant()} AS instant
      ${zonedFrom(bounds)}
        AND c.af_category IS NOT NULL
    )
    SELECT
      af_category,
      floor(extract(epoch FROM instant) / 60)::int AS minute_key,
      count(*) FILTER (
        WHERE instant >= ${bounds.dayStart} AND instant < ${bounds.seriesEnd}
      )::int AS day_n,
      count(*) FILTER (
        WHERE instant >= ${bounds.recentStart} AND instant < ${bounds.seriesEnd}
      )::int AS recent_n
    FROM zoned
    WHERE instant IS NOT NULL
      AND instant >= ${scan}
      AND instant < ${bounds.seriesEnd}
    GROUP BY 1, 2
  `;
}

export function delayMinutesSql(bounds: UtcCallWindow): Prisma.Sql {
  const scan = errorScanStart(bounds);
  return Prisma.sql`
    WITH zoned AS (
      SELECT
        c.id,
        c.unique_tag_norm,
        c.radius_session_norm,
        ${zonedInstant()} AS instant
      ${zonedFrom(bounds)}
    ),
    matched AS (
      SELECT
        z.id AS cdr_id,
        z.instant,
        t.id AS trace_id
      FROM zoned z
      INNER JOIN smg_call_traces t
        ON t.tag_norm <> ''
       AND (
         (z.unique_tag_norm <> '' AND t.tag_norm = z.unique_tag_norm)
         OR (z.radius_session_norm <> '' AND t.tag_norm = z.radius_session_norm)
       )
      WHERE z.instant IS NOT NULL
        AND z.instant >= ${scan}
        AND z.instant < ${bounds.seriesEnd}
    ),
    single AS (
      SELECT
        cdr_id,
        min(instant) AS instant,
        count(DISTINCT trace_id) AS cards,
        min(trace_id) AS trace_id
      FROM matched
      GROUP BY cdr_id
    ),
    chosen AS (
      SELECT
        s.instant,
        t.af_ms_dev,
        t.af_ms_prod,
        t.af_ms_parking
      FROM single s
      INNER JOIN smg_call_traces t ON t.id = s.trace_id
      WHERE s.cards = 1
        AND t.af_ms_dev IS NOT NULL
        AND t.af_ms_prod IS NOT NULL
        AND t.af_ms_parking IS NOT NULL
    ),
    samples AS (
      SELECT c.instant, v.line, u.ms
      FROM chosen c
      CROSS JOIN LATERAL (VALUES
        ('dev'::text, c.af_ms_dev),
        ('prod'::text, c.af_ms_prod),
        ('parking'::text, c.af_ms_parking)
      ) AS v(line, arr)
      CROSS JOIN LATERAL unnest(v.arr) AS u(ms)
    )
    SELECT
      floor(extract(epoch FROM instant) / 60)::int AS minute_key,
      line,
      round(avg(ms) FILTER (
        WHERE instant >= ${bounds.dayStart} AND instant < ${bounds.seriesEnd}
      ))::int AS day_mean,
      round(avg(ms) FILTER (
        WHERE instant >= ${bounds.recentStart} AND instant < ${bounds.seriesEnd}
      ))::int AS recent_mean
    FROM samples
    GROUP BY 1, 2
  `;
}

export function timeoutMinutesSql(bounds: UtcCallWindow): Prisma.Sql {
  const scan = errorScanStart(bounds);
  return Prisma.sql`
    SELECT
      floor(extract(epoch FROM logged_at) / 60)::int AS minute_key,
      count(*) FILTER (
        WHERE logged_at >= ${bounds.dayStart} AND logged_at < ${bounds.seriesEnd}
      )::int AS day_n,
      count(*) FILTER (
        WHERE logged_at >= ${bounds.recentStart} AND logged_at < ${bounds.seriesEnd}
      )::int AS recent_n
    FROM radius_calls
    WHERE logged_at IS NOT NULL
      AND logged_at >= ${scan}
      AND logged_at < ${bounds.seriesEnd}
    GROUP BY 1
  `;
}
