import { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  facetQueryMatchesEmptyLabel,
  type ColumnFilters,
  type FacetItem,
} from "@/components/column-filters/types";
import { isSmgField, SMG_PHONE_FIELDS, type SmgField } from "@/modules/smg/columns";
import { AF_CATEGORY, AF_STATUS } from "@/modules/smg-trace/classify";
import { smgMonthTimeRange } from "@/modules/smg/month-range";
import { CDR_DATE_CIVIL_REGEX } from "@/modules/traffic/cdr-date-parts";
import { cdrDaySearchNeedles } from "@/modules/traffic/facet-search";
import type { CdrMonth } from "@/modules/traffic/cdr-month";
import { moveEmptyFacetLast, type TimeSort } from "@/modules/traffic/traffic-sort";

/** Whitelist of CDR columns. User input never becomes an identifier. */
const SQL_COLUMN = {
  deviceSign: "device_sign",
  setupTime: "setup_time",
  connectTime: "connect_time",
  disconnectTime: "disconnect_time",
  duration: "duration",
  releaseCause: "release_cause",
  callReleaseInfo: "call_release_info",
  incomingIp: "incoming_ip",
  incomingType: "incoming_type",
  incomingDescription: "incoming_description",
  outgoingIp: "outgoing_ip",
  outgoingType: "outgoing_type",
  outgoingDescription: "outgoing_description",
  incomingCgpn: "incoming_cgpn",
  outgoingCgpn: "outgoing_cgpn",
  incomingCdpn: "incoming_cdpn",
  outgoingCdpn: "outgoing_cdpn",
  redirectingMark: "redirecting_mark",
  pickupMark: "pickup_mark",
  releaseSideMark: "release_side_mark",
  incomingSs7Cic: "incoming_ss7_cic",
  incomingSipCallId: "incoming_sip_call_id",
  outgoingSs7Cic: "outgoing_ss7_cic",
  outgoingSipCallId: "outgoing_sip_call_id",
  incomingSs7Category: "incoming_ss7_category",
  incomingCidCategory: "incoming_cid_category",
  outgoingSs7Category: "outgoing_ss7_category",
  outgoingCidCategory: "outgoing_cid_category",
  incomingE1Stream: "incoming_e1_stream",
  incomingE1Channel: "incoming_e1_channel",
  outgoingE1Stream: "outgoing_e1_stream",
  outgoingE1Channel: "outgoing_e1_channel",
  sequenceNumber: "sequence_number",
  incomingRedirectingNumber: "incoming_redirecting_number",
  outgoingRedirectingNumber: "outgoing_redirecting_number",
  radiusSessionId: "radius_session_id",
  globalCallref: "global_callref",
  incomingNumplan: "incoming_numplan",
  outgoingNumplan: "outgoing_numplan",
  uniqueTag: "unique_tag",
  callingNai: "calling_nai",
  calledNai: "called_nai",
  incomingRedirectingNai: "incoming_redirecting_nai",
  outgoingRedirectingNai: "outgoing_redirecting_nai",
  callTransferMark: "call_transfer_mark",
  callRecordPath: "call_record_path",
  ivrCallRecordPath: "ivr_call_record_path",
  rejectingRadiusAddress: "rejecting_radius_address",
  callingNaiOriginal: "calling_nai_original",
  calledNaiOriginal: "called_nai_original",
  timeInQueue: "time_in_queue",
  redirectionType: "redirection_type",
} as const satisfies Record<SmgField, string>;

const DAY_EXPR = Prisma.sql`CASE WHEN btrim(setup_time) ~ ${CDR_DATE_CIVIL_REGEX} THEN left(btrim(setup_time), 10) ELSE '' END`;
const REDIRECT_EXPR = Prisma.sql`CASE WHEN btrim(outgoing_redirecting_number) <> '' THEN btrim(outgoing_redirecting_number) ELSE btrim(incoming_redirecting_number) END`;

const DERIVED = new Set(["setupDay", "redirectNumber", "antifraud", "antifraudStatus"]);

export type SqlQuery = <T>(query: Prisma.Sql) => Promise<T>;

type Scope = {
  month: CdrMonth;
  device: string;
  phoneQ: string;
  filters: ColumnFilters;
  excludeColumn?: string;
};

function valuesOf(filters: ColumnFilters, column: string, exclude?: string): string[] {
  if (exclude === column) return [];
  return (filters[column] ?? []).map((value) => (value === EMPTY_FILTER_TOKEN ? "" : value));
}

function antifraudActive(filters: ColumnFilters, exclude?: string): boolean {
  return (
    valuesOf(filters, "antifraud", exclude).length > 0 ||
    valuesOf(filters, "antifraudStatus", exclude).length > 0
  );
}

export function smgListNeedsSql(filters: ColumnFilters): boolean {
  return (
    valuesOf(filters, "setupDay").length > 0 ||
    valuesOf(filters, "redirectNumber").length > 0 ||
    antifraudActive(filters)
  );
}

export function smgFacetNeedsSql(column: string, filters: ColumnFilters): boolean {
  return DERIVED.has(column) || smgListNeedsSql(withoutColumn(filters, column));
}

function withoutColumn(filters: ColumnFilters, column: string): ColumnFilters {
  if (!filters[column]) return filters;
  const next = { ...filters };
  delete next[column];
  return next;
}

function andAll(parts: Prisma.Sql[]): Prisma.Sql {
  if (parts.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(parts, " AND ");
}

function inList(expr: Prisma.Sql, values: string[]): Prisma.Sql | null {
  if (values.length === 0) return null;
  return Prisma.sql`${expr} IN (${Prisma.join(values)})`;
}

function col(field: SmgField): Prisma.Sql {
  return Prisma.raw(SQL_COLUMN[field]);
}

function baseWhere(scope: Scope): Prisma.Sql {
  const range = smgMonthTimeRange(scope.month);
  const parts: Prisma.Sql[] = [
    Prisma.sql`disconnect_time >= ${range.gte}`,
    Prisma.sql`disconnect_time < ${range.lt}`,
    Prisma.sql`device_sign = ${scope.device}`,
  ];
  const phone = scope.phoneQ.trim();
  if (phone) {
    const pattern = `%${phone}%`;
    parts.push(
      Prisma.sql`(${Prisma.join(
        SMG_PHONE_FIELDS.map((field) => Prisma.sql`${col(field)} ILIKE ${pattern}`),
        " OR ",
      )})`,
    );
  }
  for (const [column, rawValues] of Object.entries(scope.filters)) {
    if (column === scope.excludeColumn || column === "deviceSign") continue;
    if (!rawValues?.length || !isSmgField(column)) continue;
    const values = rawValues.map((value) => (value === EMPTY_FILTER_TOKEN ? "" : value));
    const match = inList(col(column), values);
    if (match) parts.push(match);
  }
  const day = inList(DAY_EXPR, valuesOf(scope.filters, "setupDay", scope.excludeColumn));
  if (day) parts.push(day);
  const redirect = inList(
    REDIRECT_EXPR,
    valuesOf(scope.filters, "redirectNumber", scope.excludeColumn),
  );
  if (redirect) parts.push(redirect);
  return andAll(parts);
}

function orderSql(sort: TimeSort | null): Prisma.Sql {
  if (sort === "asc") return Prisma.sql`setup_time ASC, id ASC`;
  if (sort === "desc") return Prisma.sql`setup_time DESC, id DESC`;
  return Prisma.sql`disconnect_time DESC, id DESC`;
}

function labelWhere(scope: Scope): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  const category = inList(
    Prisma.sql`af_category`,
    valuesOf(scope.filters, "antifraud", scope.excludeColumn),
  );
  const status = inList(
    Prisma.sql`af_status`,
    valuesOf(scope.filters, "antifraudStatus", scope.excludeColumn),
  );
  if (category) parts.push(category);
  if (status) parts.push(status);
  return andAll(parts);
}

/** Rows of one gateway-month with the resolved antifraud label. Pending cards keep a trace id. */
function labeledSource(scope: Scope): Prisma.Sql {
  return Prisma.sql`
    WITH base AS (
      SELECT id, unique_tag, radius_session_id, setup_time, disconnect_time,
             ${DAY_EXPR} AS setup_day,
             ${REDIRECT_EXPR} AS redirect_number
      FROM smg_cdr_records
      WHERE ${baseWhere(scope)}
    ),
    keys AS (
      SELECT id, key FROM (
        SELECT id, lower(regexp_replace(unique_tag, '[[:space:]]', '', 'g')) AS key FROM base
        UNION ALL
        SELECT id, lower(regexp_replace(radius_session_id, '[[:space:]]', '', 'g')) AS key FROM base
      ) raw_keys
      WHERE key ~ '^[0-9a-f]{16,}$' AND key !~ '^[0-9a-f]{8}0{24}$'
    ),
    agg AS (
      SELECT k.id,
             COUNT(DISTINCT t.id)::int AS n,
             MIN(t.af_category) AS category,
             MIN(t.af_status) AS status,
             MIN(t.id) AS trace_id
      FROM keys k
      JOIN smg_call_traces t ON t.tag_norm = k.key
        AND jsonb_typeof(t.blocks) = 'object'
        AND jsonb_typeof(t.blocks->'text') = 'string'
      GROUP BY k.id
    )
    SELECT b.id, b.setup_time, b.disconnect_time, b.setup_day, b.redirect_number,
           CASE
             WHEN COALESCE(a.n, 0) = 0 THEN ${AF_CATEGORY.noData}
             WHEN a.n > 1 THEN ${AF_CATEGORY.conflict}
             WHEN a.category IS NULL OR a.status IS NULL THEN NULL
             ELSE a.category
           END AS af_category,
           CASE
             WHEN COALESCE(a.n, 0) = 0 THEN ${AF_STATUS.unknown}
             WHEN a.n > 1 THEN ${AF_STATUS.unknown}
             WHEN a.category IS NULL OR a.status IS NULL THEN NULL
             ELSE a.status
           END AS af_status,
           CASE
             WHEN a.n = 1 AND (a.category IS NULL OR a.status IS NULL) THEN a.trace_id
             ELSE NULL
           END AS pending_trace
    FROM base b
    LEFT JOIN agg a ON a.id = b.id
  `;
}

type PendingRow = {
  id: string;
  pending_trace: string | null;
  af_category: string | null;
  af_status: string | null;
  value?: string | null;
};

function asCount(rows: Array<{ n: number | bigint }>): number {
  return Number(rows[0]?.n ?? 0);
}

export async function querySmgIdPage(
  query: SqlQuery,
  input: Scope & { setupSort: TimeSort | null; skip: number; take: number },
  labelsForTraces: (traceIds: string[]) => Promise<Map<string, { category: string; status: string }>>,
): Promise<{ ids: string[]; total: number }> {
  if (!antifraudActive(input.filters, input.excludeColumn)) {
    const where = baseWhere(input);
    const total = asCount(
      await query<Array<{ n: number }>>(
        Prisma.sql`SELECT COUNT(*)::int AS n FROM smg_cdr_records WHERE ${where}`,
      ),
    );
    const rows = await query<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM smg_cdr_records
      WHERE ${where}
      ORDER BY ${orderSql(input.setupSort)}
      LIMIT ${input.take} OFFSET ${input.skip}
    `);
    return { ids: rows.map((row) => row.id), total };
  }

  const src = labeledSource(input);
  const labels = labelWhere(input);
  const pending = asCount(
    await query<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM (${src}) labeled WHERE pending_trace IS NOT NULL
    `),
  );
  if (pending === 0) {
    const total = asCount(
      await query<Array<{ n: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS n FROM (${src}) labeled
        WHERE pending_trace IS NULL AND ${labels}
      `),
    );
    const rows = await query<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM (${src}) labeled
      WHERE pending_trace IS NULL AND ${labels}
      ORDER BY ${orderSql(input.setupSort)}
      LIMIT ${input.take} OFFSET ${input.skip}
    `);
    return { ids: rows.map((row) => row.id), total };
  }

  const rows = await query<PendingRow[]>(Prisma.sql`
    SELECT id, pending_trace, af_category, af_status
    FROM (${src}) labeled
    WHERE pending_trace IS NOT NULL OR (${labels})
    ORDER BY ${orderSql(input.setupSort)}
  `);
  const needed = [...new Set(rows.flatMap((row) => (row.pending_trace ? [row.pending_trace] : [])))];
  const resolved = needed.length > 0 ? await labelsForTraces(needed) : new Map();
  const wantedCategory = new Set(valuesOf(input.filters, "antifraud", input.excludeColumn));
  const wantedStatus = new Set(valuesOf(input.filters, "antifraudStatus", input.excludeColumn));
  const matched: string[] = [];
  for (const row of rows) {
    const category = row.pending_trace
      ? resolved.get(row.pending_trace)?.category
      : (row.af_category ?? undefined);
    const status = row.pending_trace
      ? resolved.get(row.pending_trace)?.status
      : (row.af_status ?? undefined);
    if (!category || !status) continue;
    if (wantedCategory.size > 0 && !wantedCategory.has(category)) continue;
    if (wantedStatus.size > 0 && !wantedStatus.has(status)) continue;
    matched.push(row.id);
  }
  return { ids: matched.slice(input.skip, input.skip + input.take), total: matched.length };
}

function searchWhere(column: string, q: string): Prisma.Sql {
  const trimmed = q.trim();
  if (!trimmed) return Prisma.sql`TRUE`;
  const needles = column === "setupDay" ? cdrDaySearchNeedles(trimmed) : [trimmed];
  const parts = needles
    .filter((needle) => needle.length > 0)
    .map((needle) => Prisma.sql`strpos(lower(value), lower(${needle})) > 0`);
  if (facetQueryMatchesEmptyLabel(trimmed)) parts.push(Prisma.sql`value = ''`);
  if (parts.length === 0) return Prisma.sql`TRUE`;
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}

function facetOrder(column: string): Prisma.Sql {
  if (column === "setupDay") {
    return Prisma.sql`CASE WHEN value = '' THEN 1 ELSE 0 END, value ASC`;
  }
  return Prisma.sql`COUNT(*) DESC`;
}

export async function querySmgFacetValues(
  query: SqlQuery,
  input: Scope & { column: string; q: string; limit: number },
  labelsForTraces: (traceIds: string[]) => Promise<Map<string, { category: string; status: string }>>,
): Promise<FacetItem[]> {
  const scope: Scope = { ...input, excludeColumn: input.column };
  const search = searchWhere(input.column, input.q);
  const limit = input.limit + 1;
  if (!antifraudActive(scope.filters) && input.column !== "antifraud" && input.column !== "antifraudStatus") {
    const value =
      input.column === "setupDay"
        ? DAY_EXPR
        : input.column === "redirectNumber"
          ? REDIRECT_EXPR
          : col(input.column as SmgField);
    const rows = await query<Array<{ value: string | null; count: number }>>(Prisma.sql`
      SELECT value, COUNT(*)::int AS count
      FROM (
        SELECT ${value} AS value
        FROM smg_cdr_records
        WHERE ${baseWhere(scope)}
      ) cells
      WHERE ${search}
      GROUP BY 1
      ORDER BY ${facetOrder(input.column)}
      LIMIT ${limit}
    `);
    return arrange(input.column, rows);
  }

  const src = labeledSource(scope);
  const labels = labelWhere(scope);
  const valueSql =
    input.column === "antifraud"
      ? Prisma.sql`af_category`
      : input.column === "antifraudStatus"
        ? Prisma.sql`af_status`
        : input.column === "setupDay"
          ? Prisma.sql`setup_day`
          : input.column === "redirectNumber"
            ? Prisma.sql`redirect_number`
            : col(input.column as SmgField);
  const pending = asCount(
    await query<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM (${src}) labeled WHERE pending_trace IS NOT NULL
    `),
  );
  if (pending === 0) {
    const rows =
      input.column === "antifraud" || input.column === "antifraudStatus" || DERIVED.has(input.column)
        ? await query<Array<{ value: string | null; count: number }>>(Prisma.sql`
            SELECT value, COUNT(*)::int AS count
            FROM (
              SELECT ${valueSql} AS value
              FROM (${src}) labeled
              WHERE pending_trace IS NULL AND ${labels}
            ) cells
            WHERE value IS NOT NULL AND ${search}
            GROUP BY 1
            ORDER BY ${facetOrder(input.column)}
            LIMIT ${limit}
          `)
        : await query<Array<{ value: string | null; count: number }>>(Prisma.sql`
            SELECT value, COUNT(*)::int AS count
            FROM (
              SELECT ${valueSql} AS value
              FROM smg_cdr_records
              WHERE id IN (
                SELECT id FROM (${src}) labeled
                WHERE pending_trace IS NULL AND ${labels}
              )
            ) cells
            WHERE ${search}
            GROUP BY 1
            ORDER BY ${facetOrder(input.column)}
            LIMIT ${limit}
          `);
    return arrange(input.column, rows);
  }

  const onLabeled =
    input.column === "antifraud" ||
    input.column === "antifraudStatus" ||
    input.column === "setupDay" ||
    input.column === "redirectNumber";
  const rows = onLabeled
    ? await query<PendingRow[]>(Prisma.sql`
        SELECT labeled.id, labeled.pending_trace, labeled.af_category, labeled.af_status,
               ${valueSql} AS value
        FROM (${src}) labeled
        WHERE labeled.pending_trace IS NOT NULL OR (${labels})
      `)
    : await query<PendingRow[]>(Prisma.sql`
        SELECT labeled.id, labeled.pending_trace, labeled.af_category, labeled.af_status,
               ${valueSql} AS value
        FROM smg_cdr_records
        JOIN (${src}) labeled ON labeled.id = smg_cdr_records.id
        WHERE labeled.pending_trace IS NOT NULL OR (${labels})
      `);
  const needed = [...new Set(rows.flatMap((row) => (row.pending_trace ? [row.pending_trace] : [])))];
  const resolved = needed.length > 0 ? await labelsForTraces(needed) : new Map();
  const wantedCategory = new Set(valuesOf(scope.filters, "antifraud", scope.excludeColumn));
  const wantedStatus = new Set(valuesOf(scope.filters, "antifraudStatus", scope.excludeColumn));
  const counts = new Map<string, number>();
  const needle = input.q.trim().toLowerCase();
  const emptyToo = facetQueryMatchesEmptyLabel(input.q);
  const dayNeedles =
    input.column === "setupDay" && needle ? cdrDaySearchNeedles(input.q.trim()).map((item) => item.toLowerCase()) : [];
  for (const row of rows) {
    const category = row.pending_trace
      ? resolved.get(row.pending_trace)?.category
      : (row.af_category ?? undefined);
    const status = row.pending_trace
      ? resolved.get(row.pending_trace)?.status
      : (row.af_status ?? undefined);
    if (!category || !status) continue;
    if (wantedCategory.size > 0 && !wantedCategory.has(category)) continue;
    if (wantedStatus.size > 0 && !wantedStatus.has(status)) continue;
    const value =
      input.column === "antifraud"
        ? category
        : input.column === "antifraudStatus"
          ? status
          : (row.value ?? "");
    if (needle) {
      const hay = value.toLowerCase();
      const needles = dayNeedles.length > 0 ? dayNeedles : [needle];
      const hit = needles.some((item) => item && hay.includes(item)) || (emptyToo && value === "");
      if (!hit) continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const items = [...counts.entries()].map(([value, count]) => ({ value, count }));
  items.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  if (input.column === "setupDay") {
    items.sort((a, b) => {
      if (a.value === "" && b.value !== "") return 1;
      if (b.value === "" && a.value !== "") return -1;
      return a.value.localeCompare(b.value);
    });
  }
  return arrange(input.column, items.slice(0, limit));
}

function arrange(
  column: string,
  rows: Array<{ value: string | null; count: number }>,
): FacetItem[] {
  const items = rows.map((row) => ({
    value: row.value ?? "",
    count: Number(row.count),
  }));
  return column === "setupDay" ? moveEmptyFacetLast(items) : items;
}
