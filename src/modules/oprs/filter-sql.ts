/**
 * OPRS slice for a painted column.
 * Stored filters stay on Prisma until «Сеть», «Маркировка», «МАВ», or Calltrace
 * is in the filter or is the open menu. Then one statement applies both.
 * A missing month prefix is refused so the plan cannot read every CDR.
 * Values are parameters. Column names come from the allowlist below.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  facetQueryMatchesEmptyLabel,
  type ColumnFilters,
} from "@/components/column-filters/types";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import type { BlockedNumberIndex } from "@/modules/phones/blocked-numbers";
import { CDR_BLOCKED_FIELDS } from "@/modules/traffic/blocked-number";
import { CALL_CATEGORY, CALL_STATUS, SUCCESS_CALL_TYPES } from "@/modules/traffic/call-class";
import { cdrMonthPrefix } from "@/lib/month-window";
import {
  CDR_PHONE_COLUMNS,
  OPRS_MARKING_COLUMN,
  OPRS_MAV_COLUMN,
  OPRS_NETWORK_COLUMN,
  VOIPMONITOR_COLUMN_IN,
  VOIPMONITOR_COLUMN_OUT,
} from "@/modules/traffic/columns";
import { facetSearchMatch } from "@/modules/traffic/facet-search";
import type { TrafficRowFlags } from "@/modules/traffic/row-flags";
import type { TimeSort } from "@/modules/traffic/traffic-sort";
import { MOBILE_RF_DIRECTION } from "@/modules/rtu/columns";
import { pstnKeyFromDigits } from "@/modules/rtu/sql";
import { PARKING_DST } from "@/modules/stats/classify";
import { OPRS_NETWORK_LABEL, type OprsCatalogLabels } from "@/modules/oprs/derived";
import { oprsNamesByTone, type OprsOperatorToneMap } from "@/modules/oprs/operator-tone";
import { OprsQueryError, oprsScreenFilters, type OprsCursor } from "@/modules/oprs/where";

const COMPUTED_COLUMNS = [
  OPRS_NETWORK_COLUMN,
  OPRS_MARKING_COLUMN,
  OPRS_MAV_COLUMN,
  VOIPMONITOR_COLUMN_IN,
  VOIPMONITOR_COLUMN_OUT,
] as const;

const STORED_COLUMN_SQL: Record<string, string> = {
  cdr_day: "cdr_day",
  cdr_time: "cdr_time",
  call_status: "call_status",
  bill_ani: "bill_ani",
  side_a: "side_a",
  bill_dnis: "bill_dnis",
  out_orig_dnis: "out_orig_dnis",
  operator_b: "operator_b",
  elapsed_time: "elapsed_time",
  src_name: "src_name",
  dst_name: "dst_name",
  dp_name: "dp_name",
  disconnect_code_string: "disconnect_code_string",
  in_ani: "in_ani",
  in_dnis: "in_dnis",
  out_ani: "out_ani",
  out_dnis: "out_dnis",
};

const BLOCKED_COLUMN_SQL: {
  [K in (typeof CDR_BLOCKED_FIELDS)[number]]: string;
} = {
  inAni: "in_ani",
  inDnis: "in_dnis",
  outAni: "out_ani",
  outDnis: "out_dnis",
  billAni: "bill_ani",
  billDnis: "bill_dnis",
  inOrigDnis: "in_orig_dnis",
  outOrigDnis: "out_orig_dnis",
  extAni: "ext_ani",
  extDnis: "ext_dnis",
  authDnis: "auth_dnis",
};

const BRAND_LABEL_SQL = {
  red: { marking: "label_mts", mav: "mav_mts" },
  green: { marking: "label_megafon", mav: "mav_megafon" },
  yellow: { marking: "label_beeline", mav: "mav_beeline" },
  gray: { marking: "label_t2", mav: "mav_t2" },
} as const;

export type OprsSqlInput = {
  year: number;
  month: number;
  filters: ColumnFilters;
  phoneQ: string;
  flags: TrafficRowFlags;
  snapshot: Date;
  cursor: OprsCursor | null;
  timeSort: TimeSort | null;
  /** Open menu. Its own selection is not applied. */
  excludeColumn?: string;
  /** Set when the statement must be able to group this column. */
  facetColumn?: string;
};

export type OprsSqlContext = {
  tones: OprsOperatorToneMap;
  blocked: BlockedNumberIndex;
  marking: ReadonlyMap<string, OprsCatalogLabels> | null;
  guiHost: string;
};

export type OprsSliceSql = {
  from: Prisma.Sql;
  where: Prisma.Sql;
  exprs: Partial<Record<string, Prisma.Sql>>;
};

export function oprsNeedsComputedSql(
  filters: ColumnFilters,
  facetColumn?: string,
): boolean {
  if (facetColumn && isOprsComputedColumn(facetColumn)) return true;
  return COMPUTED_COLUMNS.some((column) => (filters[column]?.length ?? 0) > 0);
}

export function oprsUsesMarking(filters: ColumnFilters, facetColumn?: string): boolean {
  return (
    facetColumn === OPRS_MARKING_COLUMN ||
    facetColumn === OPRS_MAV_COLUMN ||
    (filters[OPRS_MARKING_COLUMN]?.length ?? 0) > 0 ||
    (filters[OPRS_MAV_COLUMN]?.length ?? 0) > 0
  );
}

export function oprsUsesCalltrace(filters: ColumnFilters, facetColumn?: string): boolean {
  return (
    facetColumn === VOIPMONITOR_COLUMN_IN ||
    facetColumn === VOIPMONITOR_COLUMN_OUT ||
    (filters[VOIPMONITOR_COLUMN_IN]?.length ?? 0) > 0 ||
    (filters[VOIPMONITOR_COLUMN_OUT]?.length ?? 0) > 0
  );
}

export function isOprsComputedColumn(column: string): boolean {
  return (COMPUTED_COLUMNS as readonly string[]).includes(column);
}

export function oprsStoredColumnSql(column: string): string {
  const name = STORED_COLUMN_SQL[column];
  if (!name || !/^[a-z0-9_]+$/.test(name)) {
    throw new OprsQueryError("Некорректный столбец");
  }
  return name;
}

/** `%`, `_`, and `\` stay letters in ILIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function requireOprsMonthPrefix(year: number, month: number): string {
  let prefix: string;
  try {
    prefix = cdrMonthPrefix(year, month);
  } catch (error: unknown) {
    throw new OprsQueryError(error instanceof Error ? error.message : "Некорректный месяц");
  }
  if (!/^\d{4}-\d{2}-$/.test(prefix)) throw new OprsQueryError("Некорректный месяц");
  return prefix;
}

/** One JSON parameter. Phones whose eight cells are blank are omitted. */
export function oprsMarkingJson(
  marking: ReadonlyMap<string, OprsCatalogLabels> | null,
): string {
  if (!marking) return "[]";
  const rows: Array<Record<string, string>> = [];
  for (const [number, cells] of marking) {
    const phone = number.trim();
    if (!phone) continue;
    if (
      !cells.labelMts &&
      !cells.labelMegafon &&
      !cells.labelBeeline &&
      !cells.labelT2 &&
      !cells.mavMts &&
      !cells.mavMegafon &&
      !cells.mavBeeline &&
      !cells.mavT2
    ) {
      continue;
    }
    rows.push({
      number: phone,
      label_mts: cells.labelMts,
      label_megafon: cells.labelMegafon,
      label_beeline: cells.labelBeeline,
      label_t2: cells.labelT2,
      mav_mts: cells.mavMts,
      mav_megafon: cells.mavMegafon,
      mav_beeline: cells.mavBeeline,
      mav_t2: cells.mavT2,
    });
  }
  return JSON.stringify(rows);
}

export function buildOprsSliceSql(input: OprsSqlInput, ctx: OprsSqlContext): OprsSliceSql {
  if (!(input.snapshot instanceof Date) || Number.isNaN(input.snapshot.getTime())) {
    throw new OprsQueryError("Некорректный снимок списка");
  }
  const prefix = requireOprsMonthPrefix(input.year, input.month);
  const names = oprsNamesByTone(ctx.tones);
  const paint = usesPaint(input.filters, input.facetColumn);
  const marking = oprsUsesMarking(input.filters, input.facetColumn);
  const calltrace = oprsUsesCalltrace(input.filters, input.facetColumn);
  const blocked =
    paint && (ctx.blocked.exact.size > 0 || ctx.blocked.pstn.size > 0)
      ? blockedExists(ctx.blocked)
      : null;
  const blockedRef = blocked ? Prisma.sql`blk.blocked` : Prisma.sql`FALSE`;
  const exprs = paintExprs(names, blockedRef, ctx.guiHost, { marking, calltrace });
  const from = fromSql({
    blocked,
    markingJson: marking ? oprsMarkingJson(ctx.marking) : null,
    calltrace: calltrace && ctx.guiHost !== "",
  });
  const where = andSql([
    Prisma.sql`c.cdr_date LIKE ${`${prefix}%`}`,
    predicateSql(),
    columnFiltersSql(input.filters, input.excludeColumn),
    phoneSql(input.phoneQ),
    flagSql(input.flags),
    Prisma.sql`c."importedAt" <= ${input.snapshot}`,
    input.cursor ? keysetSql(input.timeSort, input.cursor) : null,
    computedFiltersSql(input.filters, input.excludeColumn, exprs),
  ]);
  return { from, where, exprs };
}

export function buildOprsFacetSql(
  input: OprsSqlInput,
  ctx: OprsSqlContext,
  column: string,
  q: string,
  limit: number,
): Prisma.Sql {
  const slice = buildOprsSliceSql(
    { ...input, excludeColumn: column, facetColumn: column },
    ctx,
  );
  const expr = isOprsComputedColumn(column) ? slice.exprs[column] : storedExpr(column);
  if (!expr) throw new OprsQueryError("Некорректный столбец");
  const take = Math.min(500, Math.max(1, limit)) + 1;
  const order = column === "cdr_day" ? Prisma.sql`value ASC` : Prisma.sql`COUNT(*) DESC`;
  return Prisma.sql`
    SELECT value, COUNT(*)::bigint AS count
    FROM (
      SELECT ${expr} AS value
      FROM ${slice.from}
      WHERE ${slice.where}
        AND ${oprsFacetMatchSql(column, expr, q)}
    ) facet_rows
    GROUP BY value
    ORDER BY ${order}
    LIMIT ${take}
  `;
}

export function oprsFacetMatchSql(column: string, expr: Prisma.Sql, q: string): Prisma.Sql {
  const trimmed = q.trim();
  if (!trimmed) return Prisma.sql`TRUE`;
  if (isOprsComputedColumn(column)) return likeOrEmpty(expr, trimmed);
  const match = facetSearchMatch(column, trimmed);
  const empty = facetQueryMatchesEmptyLabel(trimmed);
  if (match.kind === "in") {
    const listed = equalsAny(expr, match.values);
    return empty ? Prisma.sql`(${listed} OR ${expr} = '')` : listed;
  }
  const likes = match.needles.map((needle) => likeSql(expr, needle));
  const listed = likes.length === 0 ? null : orSql(likes);
  if (empty && listed) return Prisma.sql`(${listed} OR ${expr} = '')`;
  if (empty) return Prisma.sql`${expr} = ''`;
  return listed ?? Prisma.sql`TRUE`;
}

function usesPaint(filters: ColumnFilters, facetColumn?: string): boolean {
  return (
    facetColumn === OPRS_NETWORK_COLUMN ||
    oprsUsesMarking(filters, facetColumn) ||
    (filters[OPRS_NETWORK_COLUMN]?.length ?? 0) > 0
  );
}

function paintExprs(
  names: ReturnType<typeof oprsNamesByTone>,
  blocked: Prisma.Sql,
  guiHost: string,
  opts: { marking: boolean; calltrace: boolean },
): Partial<Record<string, Prisma.Sql>> {
  const exprs: Partial<Record<string, Prisma.Sql>> = {
    [OPRS_NETWORK_COLUMN]: networkExpr(names, blocked),
  };
  if (opts.marking) {
    exprs[OPRS_MARKING_COLUMN] = brandExpr(names, blocked, "marking");
    exprs[OPRS_MAV_COLUMN] = brandExpr(names, blocked, "mav");
  }
  if (opts.calltrace) {
    exprs[VOIPMONITOR_COLUMN_IN] = calltraceExpr("in", guiHost);
    exprs[VOIPMONITOR_COLUMN_OUT] = calltraceExpr("out", guiHost);
  }
  return exprs;
}

function networkExpr(
  names: ReturnType<typeof oprsNamesByTone>,
  blocked: Prisma.Sql,
): Prisma.Sql {
  const arms = (Object.keys(OPRS_NETWORK_LABEL) as Array<keyof typeof OPRS_NETWORK_LABEL>).map(
    (tone) =>
      Prisma.sql`WHEN ${nameIn(names[tone])} AND NOT (${blocked}) THEN ${OPRS_NETWORK_LABEL[tone]}`,
  );
  return Prisma.sql`(CASE ${Prisma.join(arms, " ")} ELSE '' END)`;
}

function brandExpr(
  names: ReturnType<typeof oprsNamesByTone>,
  blocked: Prisma.Sql,
  kind: "marking" | "mav",
): Prisma.Sql {
  const tones = Object.keys(BRAND_LABEL_SQL) as Array<keyof typeof BRAND_LABEL_SQL>;
  const arms = tones.map((tone) => {
    const field = BRAND_LABEL_SQL[tone][kind];
    if (!/^[a-z0-9_]+$/.test(field)) throw new OprsQueryError("Некорректный столбец");
    return Prisma.sql`WHEN ${nameIn(names[tone])} AND NOT (${blocked}) THEN COALESCE(lab.${Prisma.raw(field)}, '')`;
  });
  return Prisma.sql`(CASE ${Prisma.join(arms, " ")} ELSE '' END)`;
}

function nameIn(names: readonly string[]): Prisma.Sql {
  if (names.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`btrim(c.operator_b) IN (${Prisma.join([...names])})`;
}

function calltraceExpr(side: "in" | "out", host: string): Prisma.Sql {
  if (!host) return Prisma.sql`''`;
  const url = Prisma.raw(`btrim(COALESCE(l.voipmonitor_legs->'${side}'->>'url', ''))`);
  const id = Prisma.raw(`btrim(COALESCE(l.voipmonitor_legs->'${side}'->>'cdrId', ''))`);
  const scheme = Prisma.sql`(CASE WHEN ${url} ~* '^https://' THEN 'https' WHEN ${url} ~* '^http://' THEN 'http' ELSE '' END)`;
  const authority = Prisma.sql`lower(regexp_replace(COALESCE(substring(${url} from '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]*)'), ''), '^.*@', ''))`;
  const normalized = Prisma.sql`(
    CASE
      WHEN ${scheme} = 'https' AND right(${authority}, 4) = ':443'
        THEN left(${authority}, -4)
      WHEN ${scheme} = 'http' AND right(${authority}, 3) = ':80'
        THEN left(${authority}, -3)
      ELSE ${authority}
    END
  )`;
  return Prisma.sql`(
    CASE
      WHEN ${scheme} <> '' AND ${normalized} = lower(${host})
        THEN COALESCE(NULLIF(${id}, ''), ${"открыть"})
      ELSE ''
    END
  )`;
}

function blockedExists(index: BlockedNumberIndex): Prisma.Sql {
  const values = CDR_BLOCKED_FIELDS.map((field) => {
    const column = BLOCKED_COLUMN_SQL[field];
    return Prisma.sql`btrim(c.${Prisma.raw(column)})`;
  });
  const checks: Prisma.Sql[] = [];
  const exact = [...index.exact];
  const pstn = [...index.pstn];
  if (exact.length > 0) {
    checks.push(Prisma.sql`v = ANY(ARRAY[${Prisma.join(exact)}]::text[])`);
  }
  if (pstn.length > 0) {
    const digits = Prisma.sql`regexp_replace(v, '[^0-9]', '', 'g')`;
    checks.push(
      Prisma.sql`${pstnKeyFromDigits(digits)} = ANY(ARRAY[${Prisma.join(pstn)}]::text[])`,
    );
  }
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM unnest(ARRAY[${Prisma.join(values)}]::text[]) AS v
    WHERE v <> ''
      AND (${Prisma.join(checks, " OR ")})
  )`;
}

function fromSql(input: {
  blocked: Prisma.Sql | null;
  markingJson: string | null;
  calltrace: boolean;
}): Prisma.Sql {
  const joins: Prisma.Sql[] = [];
  if (input.blocked) {
    joins.push(
      Prisma.sql`LEFT JOIN LATERAL (SELECT ${input.blocked} AS blocked) blk ON TRUE`,
    );
  }
  if (input.markingJson != null) {
    joins.push(Prisma.sql`LEFT JOIN jsonb_to_recordset(CAST(${input.markingJson} AS jsonb)) AS lab(
      number text,
      label_mts text,
      label_megafon text,
      label_beeline text,
      label_t2 text,
      mav_mts text,
      mav_megafon text,
      mav_beeline text,
      mav_t2 text
    ) ON lab.number = btrim(c.bill_ani)`);
  }
  if (input.calltrace) {
    joins.push(
      Prisma.sql`LEFT JOIN cdr_voipmonitor_links l ON l.cdr_record_id = c.id`,
    );
  }
  if (joins.length === 0) return Prisma.sql`cdr_records c`;
  return Prisma.sql`cdr_records c ${Prisma.join(joins, " ")}`;
}

function predicateSql(): Prisma.Sql {
  return Prisma.sql`c.call_category = ${CALL_CATEGORY.outgoing}
    AND c.tariff_direction = ${MOBILE_RF_DIRECTION}
    AND c.dst_name <> ${PARKING_DST}
    AND c.operator_b <> ${MISSING_PSTN_LABEL}`;
}

function columnFiltersSql(filters: ColumnFilters, exclude?: string): Prisma.Sql | null {
  const parts: Prisma.Sql[] = [];
  for (const [column, values] of Object.entries(oprsScreenFilters(filters))) {
    if (exclude === column || !values?.length) continue;
    parts.push(equalsAny(storedExpr(column), tokenTexts(values)));
  }
  return parts.length === 0 ? null : andSql(parts);
}

function computedFiltersSql(
  filters: ColumnFilters,
  exclude: string | undefined,
  exprs: Partial<Record<string, Prisma.Sql>>,
): Prisma.Sql | null {
  const parts: Prisma.Sql[] = [];
  for (const column of COMPUTED_COLUMNS) {
    if (column === exclude) continue;
    const values = filters[column];
    if (!values?.length) continue;
    const expr = exprs[column];
    if (!expr) throw new OprsQueryError("Некорректный столбец");
    parts.push(equalsAny(expr, tokenTexts(values)));
  }
  return parts.length === 0 ? null : andSql(parts);
}

function phoneSql(phoneQ: string): Prisma.Sql | null {
  const q = phoneQ.trim();
  if (!q) return null;
  const parts = CDR_PHONE_COLUMNS.map((column) => likeSql(storedExpr(column), q));
  return orSql(parts);
}

function flagSql(flags: TrafficRowFlags): Prisma.Sql | null {
  const parts: Prisma.Sql[] = [];
  if (flags.phantom) parts.push(Prisma.sql`c.call_category = ${CALL_CATEGORY.phantom}`);
  if (flags.callErrors) parts.push(Prisma.sql`c.call_category = ${CALL_CATEGORY.errors}`);
  if (flags.parking) parts.push(Prisma.sql`c.call_status = ${CALL_STATUS.parking}`);
  if (flags.failed) parts.push(Prisma.sql`c.call_status = ${CALL_STATUS.failed}`);
  if (flags.check) parts.push(Prisma.sql`c.call_category = ${CALL_CATEGORY.check}`);
  if (flags.success) {
    parts.push(Prisma.sql`(
      c.call_status = ${CALL_STATUS.success}
      AND (
        c.call_category = ${CALL_CATEGORY.incoming}
        OR (
          c.call_category = ${CALL_CATEGORY.outgoing}
          AND c.call_type IN (${Prisma.join([...SUCCESS_CALL_TYPES])})
        )
      )
    )`);
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return orSql(parts);
}

function keysetSql(timeSort: TimeSort | null, cursor: OprsCursor): Prisma.Sql {
  if (timeSort === "asc") {
    return Prisma.sql`(
      c.cdr_date > ${cursor.cdrDate}
      OR (c.cdr_date = ${cursor.cdrDate} AND c.cdr_id > ${cursor.cdrId})
    )`;
  }
  return Prisma.sql`(
    c.cdr_date < ${cursor.cdrDate}
    OR (c.cdr_date = ${cursor.cdrDate} AND c.cdr_id < ${cursor.cdrId})
  )`;
}

function storedExpr(column: string): Prisma.Sql {
  return Prisma.raw(`c.${oprsStoredColumnSql(column)}`);
}

function tokenTexts(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => (value === EMPTY_FILTER_TOKEN ? "" : value)))];
}

function equalsAny(expr: Prisma.Sql, values: readonly string[]): Prisma.Sql {
  if (values.length === 0) return Prisma.sql`FALSE`;
  if (values.length === 1) return Prisma.sql`${expr} = ${values[0]!}`;
  return Prisma.sql`${expr} IN (${Prisma.join([...values])})`;
}

function likeSql(expr: Prisma.Sql, needle: string): Prisma.Sql {
  return Prisma.sql`${expr} ILIKE ${"%" + escapeLike(needle) + "%"} ESCAPE E'\\\\'`;
}

function likeOrEmpty(expr: Prisma.Sql, q: string): Prisma.Sql {
  const like = likeSql(expr, q);
  if (!facetQueryMatchesEmptyLabel(q)) return like;
  return Prisma.sql`(${like} OR ${expr} = '')`;
}

function andSql(parts: Array<Prisma.Sql | null>): Prisma.Sql {
  const present = parts.filter((part): part is Prisma.Sql => part != null);
  if (present.length === 0) return Prisma.sql`TRUE`;
  if (present.length === 1) return present[0]!;
  return Prisma.sql`(${Prisma.join(present, " AND ")})`;
}

function orSql(parts: Prisma.Sql[]): Prisma.Sql {
  if (parts.length === 0) return Prisma.sql`FALSE`;
  if (parts.length === 1) return parts[0]!;
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}
