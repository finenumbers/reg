/**
 * One working set for the marking list, the export, and the import guard.
 * A number stays when it is on the switch and its operator is not the
 * ministry-registry miss. An empty operator stays. The phone is the trimmed
 * screen number. Several screen rows with that number keep one client.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  type ColumnFilters,
} from "@/components/column-filters/types";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import {
  isMarkingColumn,
  type MarkingColumnId,
} from "@/modules/marking/query-filter";
import { operatorLabelSql } from "@/modules/rtu/sql";
import { STATUS_NOT_IN_RTU } from "@/modules/rtu/types";

function andWhere(clauses: Prisma.Sql[]): Prisma.Sql {
  if (clauses.length === 0) return Prisma.sql`TRUE`;
  if (clauses.length === 1) return clauses[0]!;
  return Prisma.sql`(${Prisma.join(clauses, " AND ")})`;
}

/** Display text on the marked CTE. Labels treat NULL as empty. */
export function markingValueSql(column: MarkingColumnId): Prisma.Sql {
  switch (column) {
    case "client":
      return Prisma.sql`client`;
    case "phoneNumber":
      return Prisma.sql`number`;
    case "labelMts":
      return Prisma.sql`COALESCE(label_mts, '')`;
    case "labelMegafon":
      return Prisma.sql`COALESCE(label_megafon, '')`;
    case "labelBeeline":
      return Prisma.sql`COALESCE(label_beeline, '')`;
    case "labelT2":
      return Prisma.sql`COALESCE(label_t2, '')`;
    case "mavMts":
      return Prisma.sql`COALESCE(mav_mts, '')`;
    case "mavMegafon":
      return Prisma.sql`COALESCE(mav_megafon, '')`;
    case "mavBeeline":
      return Prisma.sql`COALESCE(mav_beeline, '')`;
    case "mavT2":
      return Prisma.sql`COALESCE(mav_t2, '')`;
  }
}

export function markingFilterSql(
  filters: ColumnFilters | undefined,
  excludeColumn?: string,
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  for (const [column, values] of Object.entries(filters ?? {})) {
    if (!isMarkingColumn(column) || values.length === 0) continue;
    if (excludeColumn && column === excludeColumn) continue;
    const wantsEmpty = values.includes(EMPTY_FILTER_TOKEN);
    const texts = values.filter((value) => value !== EMPTY_FILTER_TOKEN);
    const expr = markingValueSql(column);
    const parts: Prisma.Sql[] = [];
    if (wantsEmpty) parts.push(Prisma.sql`${expr} = ''`);
    if (texts.length > 0) parts.push(Prisma.sql`${expr} IN (${Prisma.join(texts)})`);
    if (parts.length === 1) clauses.push(parts[0]!);
    else if (parts.length > 1) clauses.push(Prisma.sql`(${Prisma.join(parts, " OR ")})`);
  }
  return andWhere(clauses);
}

/** On-switch numbers. An empty operator stays. The registry-miss label does not. */
export function markingWorkingCte(): Prisma.Sql {
  return Prisma.sql`
    /* marking-working-set */
    on_switch AS (
      SELECT DISTINCT ON (btrim(number))
        btrim(number) AS number,
        btrim(client) AS client,
        "pstnKey" AS pstn_key
      FROM rtu_screen
      WHERE NOT missing
        AND btrim(number) <> ''
        AND activation <> ${STATUS_NOT_IN_RTU}
      ORDER BY btrim(number), (btrim(client) = ''), id
    ),
    joined AS (
      SELECT
        s.number,
        s.client,
        c.phone AS pstn_phone,
        c.found AS pstn_found,
        c.operator AS pstn_operator
      FROM on_switch s
      LEFT JOIN pstn_phone_cache c
        ON c.phone = s.pstn_key
    ),
    labeled AS (
      SELECT
        number,
        client,
        ${operatorLabelSql()} AS operator
      FROM joined
    ),
    working AS (
      SELECT number, client
      FROM labeled
      WHERE operator <> ${MISSING_PSTN_LABEL}
    )
  `;
}

function markedCte(): Prisma.Sql {
  return Prisma.sql`
    marked AS (
      SELECT
        w.number,
        w.client,
        m."labelMts" AS label_mts,
        m."labelMegafon" AS label_megafon,
        m."labelBeeline" AS label_beeline,
        m."labelT2" AS label_t2,
        m."mavMts" AS mav_mts,
        m."mavMegafon" AS mav_megafon,
        m."mavBeeline" AS mav_beeline,
        m."mavT2" AS mav_t2
      FROM working w
      LEFT JOIN marking_rows m
        ON m."phoneNumber" = w.number
    )
  `;
}

export function markingListSql(opts: {
  where: Prisma.Sql;
  cursor: string | null;
  limit: number;
}): Prisma.Sql {
  const cursor = opts.cursor
    ? Prisma.sql`number > ${opts.cursor}`
    : Prisma.sql`TRUE`;
  return Prisma.sql`
    WITH ${markingWorkingCte()},
    ${markedCte()},
    filtered AS (
      SELECT *
      FROM marked
      WHERE ${opts.where}
    ),
    counts AS (
      SELECT
        (SELECT count(*)::int FROM filtered) AS n,
        (SELECT count(*)::int FROM working) AS working_n,
        (
          SELECT "catalogRevision"::int
          FROM rtu_screen_state
          WHERE id = 1
        ) AS catalog_revision,
        (
          SELECT filename
          FROM marking_import_state
          WHERE id = 1
        ) AS filename,
        (
          SELECT "loadedAt"
          FROM marking_import_state
          WHERE id = 1
        ) AS loaded_at
    ),
    page AS (
      SELECT *
      FROM filtered
      WHERE ${cursor}
      ORDER BY number ASC
      LIMIT ${opts.limit}
    )
    SELECT
      page.number,
      page.client,
      page.label_mts,
      page.label_megafon,
      page.label_beeline,
      page.label_t2,
      page.mav_mts,
      page.mav_megafon,
      page.mav_beeline,
      page.mav_t2,
      counts.n,
      counts.working_n,
      counts.catalog_revision,
      counts.filename,
      counts.loaded_at
    FROM counts
    LEFT JOIN page ON TRUE
    ORDER BY page.number ASC NULLS FIRST
  `;
}

export function markingFacetSql(column: MarkingColumnId, where: Prisma.Sql): Prisma.Sql {
  const expr = markingValueSql(column);
  return Prisma.sql`
    WITH ${markingWorkingCte()},
    ${markedCte()},
    filtered AS (
      SELECT *
      FROM marked
      WHERE ${where}
    )
    SELECT ${expr} AS value, count(*)::int AS count
    FROM filtered
    GROUP BY 1
  `;
}

/** Whole working set. No column filter: a filtered file would fail the import. */
export function markingExportSql(limit: number): Prisma.Sql {
  return Prisma.sql`
    WITH ${markingWorkingCte()},
    ${markedCte()}
    SELECT
      number,
      client,
      label_mts,
      label_megafon,
      label_beeline,
      label_t2,
      mav_mts,
      mav_megafon,
      mav_beeline,
      mav_t2
    FROM marked
    ORDER BY number ASC
    LIMIT ${limit}
  `;
}

function markingGuardSql(): Prisma.Sql {
  return Prisma.sql`(
    SELECT published IS TRUE
      AND incoming_distinct = incoming_n
      AND working_n = incoming_n
      AND matched = working_n
      AND incoming_n > 0
    FROM stats
  )`;
}

/**
 * One statement. The insert and the import stamp run only when the file's
 * phones equal the live working set. Otherwise neither write lands.
 */
export function markingApplySql(
  payload: string,
  filename: string,
  loadedAt: Date,
): Prisma.Sql {
  const guard = markingGuardSql();
  return Prisma.sql`
    WITH ${markingWorkingCte()},
    incoming AS (
      SELECT *
      FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        phone text,
        "labelMts" text,
        "labelMegafon" text,
        "labelBeeline" text,
        "labelT2" text,
        "mavMts" text,
        "mavMegafon" text,
        "mavBeeline" text,
        "mavT2" text
      )
    ),
    stats AS (
      SELECT
        (SELECT count(*)::int FROM working) AS working_n,
        (SELECT count(*)::int FROM incoming) AS incoming_n,
        (SELECT count(DISTINCT phone)::int FROM incoming) AS incoming_distinct,
        (
          SELECT count(*)::int
          FROM working w
          INNER JOIN incoming i ON i.phone = w.number
        ) AS matched,
        (
          SELECT published
          FROM rtu_screen_state
          WHERE id = 1
        ) AS published
    ),
    absent AS (
      SELECT w.number
      FROM working w
      WHERE NOT EXISTS (
        SELECT 1 FROM incoming i WHERE i.phone = w.number
      )
      ORDER BY w.number
      LIMIT 30
    ),
    extra AS (
      SELECT i.phone
      FROM incoming i
      WHERE i.phone IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM working w WHERE w.number = i.phone
        )
      ORDER BY i.phone
      LIMIT 30
    ),
    written AS (
      INSERT INTO marking_rows (
        id,
        "sortIndex",
        client,
        "phoneNumber",
        "labelMts",
        "labelMegafon",
        "labelBeeline",
        "labelT2",
        "mavMts",
        "mavMegafon",
        "mavBeeline",
        "mavT2"
      )
      SELECT
        gen_random_uuid()::text,
        0,
        '',
        i.phone,
        NULLIF(i."labelMts", ''),
        NULLIF(i."labelMegafon", ''),
        NULLIF(i."labelBeeline", ''),
        NULLIF(i."labelT2", ''),
        NULLIF(i."mavMts", ''),
        NULLIF(i."mavMegafon", ''),
        NULLIF(i."mavBeeline", ''),
        NULLIF(i."mavT2", '')
      FROM incoming i
      WHERE ${guard}
      ON CONFLICT ("phoneNumber") DO UPDATE SET
        "labelMts" = EXCLUDED."labelMts",
        "labelMegafon" = EXCLUDED."labelMegafon",
        "labelBeeline" = EXCLUDED."labelBeeline",
        "labelT2" = EXCLUDED."labelT2",
        "mavMts" = EXCLUDED."mavMts",
        "mavMegafon" = EXCLUDED."mavMegafon",
        "mavBeeline" = EXCLUDED."mavBeeline",
        "mavT2" = EXCLUDED."mavT2"
      RETURNING 1
    ),
    state_row AS (
      INSERT INTO marking_import_state (
        id,
        "rowCount",
        generation,
        filename,
        "loadedAt",
        "updatedAt"
      )
      SELECT 1, incoming_n, 1, ${filename}, ${loadedAt}, NOW()
      FROM stats
      WHERE ${guard}
      ON CONFLICT (id) DO UPDATE SET
        "rowCount" = EXCLUDED."rowCount",
        generation = marking_import_state.generation + 1,
        filename = EXCLUDED.filename,
        "loadedAt" = EXCLUDED."loadedAt",
        "updatedAt" = NOW()
      RETURNING 1
    )
    SELECT
      stats.working_n,
      stats.incoming_n,
      stats.incoming_distinct,
      stats.matched,
      stats.published,
      (SELECT count(*)::int FROM written) AS written_n,
      (SELECT count(*)::int FROM state_row) AS state_n,
      COALESCE(
        (SELECT jsonb_agg(number ORDER BY number) FROM absent),
        '[]'::jsonb
      ) AS missing_sample,
      COALESCE(
        (SELECT jsonb_agg(phone ORDER BY phone) FROM extra),
        '[]'::jsonb
      ) AS unknown_sample
    FROM stats
  `;
}

export function markingLockSql(): Prisma.Sql {
  return Prisma.sql`SELECT pg_advisory_xact_lock(4815162342003::bigint)`;
}
