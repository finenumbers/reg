/**
 * List, count, and facet when an OPRS cell is not a CDR column.
 * Tone names, the blocked index, and the marking snapshot are loaded by the
 * caller before this transaction. The statement itself only reads CDR rows.
 */

import { Prisma } from "@/generated/prisma/client";
import { toFilterToken, type FacetResponse } from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import type { BlockedNumberIndex } from "@/modules/phones/blocked-numbers";
import { loadBlockedNumbers } from "@/modules/phones/blocked-numbers";
import { arrangeTrafficFacetItems } from "@/modules/traffic/traffic-sort";
import { oprsGuiHost } from "@/modules/oprs/calltrace";
import type { OprsCatalogLabels } from "@/modules/oprs/derived";
import {
  buildOprsFacetSql,
  buildOprsSliceSql,
  oprsUsesCalltrace,
  oprsUsesMarking,
  type OprsSqlContext,
  type OprsSqlInput,
} from "@/modules/oprs/filter-sql";
import { loadOprsMarkingSnapshot } from "@/modules/oprs/marking-snapshot";
import type { OprsOperatorToneMap } from "@/modules/oprs/operator-tone";
import { loadOprsOperatorToneMap } from "@/modules/oprs/operator-tone-load";
import type { OprsListRow } from "@/modules/oprs/row";
import { OprsQueryError } from "@/modules/oprs/where";

export type OprsReadContext = OprsSqlContext & {
  tones: OprsOperatorToneMap;
  blocked: BlockedNumberIndex;
  marking: Map<string, OprsCatalogLabels> | null;
};

const LIST_COLUMNS = Prisma.sql`
  c.id AS id,
  c."cdrAt" AS "cdrAt",
  c.cdr_id AS "cdrId",
  c.cdr_date AS "cdrDate",
  c.cdr_day AS "cdrDay",
  c.cdr_time AS "cdrTime",
  c.call_category AS "callCategory",
  c.call_status AS "callStatus",
  c.bill_ani AS "billAni",
  c.side_a AS "sideA",
  c.bill_dnis AS "billDnis",
  c.out_orig_dnis AS "outOrigDnis",
  c.elapsed_time AS "elapsedTime",
  c.operator_b AS "operatorB",
  c.src_name AS "srcName",
  c.dst_name AS "dstName",
  c.dp_name AS "dpName",
  c.disconnect_code_string AS "disconnectCodeString",
  c.in_ani AS "inAni",
  c.in_dnis AS "inDnis",
  c.out_ani AS "outAni",
  c.out_dnis AS "outDnis",
  c.in_orig_dnis AS "inOrigDnis",
  c.ext_ani AS "extAni",
  c.ext_dnis AS "extDnis",
  c.auth_dnis AS "authDnis"
`;

type RawRow = {
  id: string;
  cdrAt: Date | null;
  cdrId: string;
  cdrDate: string;
  cdrDay: string;
  cdrTime: string;
  callCategory: string;
  callStatus: string;
  billAni: string;
  sideA: string;
  billDnis: string;
  outOrigDnis: string;
  elapsedTime: string;
  operatorB: string;
  srcName: string;
  dstName: string;
  dpName: string;
  disconnectCodeString: string;
  inAni: string;
  inDnis: string;
  outAni: string;
  outDnis: string;
  inOrigDnis: string;
  extAni: string;
  extDnis: string;
  authDnis: string;
};

function text(value: string | null | undefined): string {
  return value ?? "";
}

function asRow(raw: RawRow): OprsListRow {
  if (!raw.id || !raw.cdrId || raw.cdrDate == null) {
    throw new OprsQueryError("Некорректная строка списка");
  }
  return {
    id: raw.id,
    cdrAt: raw.cdrAt,
    cdrId: raw.cdrId,
    cdrDate: text(raw.cdrDate),
    cdrDay: text(raw.cdrDay),
    cdrTime: text(raw.cdrTime),
    callCategory: text(raw.callCategory),
    callStatus: text(raw.callStatus),
    billAni: text(raw.billAni),
    sideA: text(raw.sideA),
    billDnis: text(raw.billDnis),
    outOrigDnis: text(raw.outOrigDnis),
    elapsedTime: text(raw.elapsedTime),
    operatorB: text(raw.operatorB),
    srcName: text(raw.srcName),
    dstName: text(raw.dstName),
    dpName: text(raw.dpName),
    disconnectCodeString: text(raw.disconnectCodeString),
    inAni: text(raw.inAni),
    inDnis: text(raw.inDnis),
    outAni: text(raw.outAni),
    outDnis: text(raw.outDnis),
    inOrigDnis: text(raw.inOrigDnis),
    extAni: text(raw.extAni),
    extDnis: text(raw.extDnis),
    authDnis: text(raw.authDnis),
  };
}

function asCount(value: unknown): number {
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new OprsQueryError("Некорректный подсчёт");
  return n;
}

async function readGuiHost(): Promise<string> {
  const setting = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { voipmonitorGuiUrl: true },
  });
  return oprsGuiHost(setting?.voipmonitorGuiUrl ?? "");
}

export async function loadOprsReadContext(
  filters: OprsSqlInput["filters"],
  facetColumn?: string,
): Promise<OprsReadContext> {
  const marking = oprsUsesMarking(filters, facetColumn);
  const calltrace = oprsUsesCalltrace(filters, facetColumn);
  const [tones, blocked, labels, guiHost] = await Promise.all([
    loadOprsOperatorToneMap(),
    loadBlockedNumbers(),
    marking ? loadOprsMarkingSnapshot() : Promise.resolve(null),
    calltrace ? readGuiHost() : Promise.resolve(""),
  ]);
  return { tones, blocked, marking: labels, guiHost };
}

export async function countOprsSlice(
  tx: Prisma.TransactionClient,
  input: OprsSqlInput,
  ctx: OprsSqlContext,
): Promise<number> {
  const slice = buildOprsSliceSql(input, ctx);
  const rows = await tx.$queryRaw<Array<{ count: unknown }>>`
    SELECT COUNT(*)::bigint AS count
    FROM ${slice.from}
    WHERE ${slice.where}
  `;
  return asCount(rows[0]?.count ?? 0);
}

export async function fetchOprsSlice(
  tx: Prisma.TransactionClient,
  input: OprsSqlInput,
  ctx: OprsSqlContext,
  pageSize: number,
): Promise<OprsListRow[]> {
  const slice = buildOprsSliceSql(input, ctx);
  const order =
    input.timeSort === "asc"
      ? Prisma.sql`c.cdr_date ASC, c.cdr_id ASC`
      : Prisma.sql`c.cdr_date DESC, c.cdr_id DESC`;
  const rows = await tx.$queryRaw<RawRow[]>`
    SELECT ${LIST_COLUMNS}
    FROM ${slice.from}
    WHERE ${slice.where}
    ORDER BY ${order}
    LIMIT ${pageSize}
  `;
  return rows.map(asRow);
}

export async function readOprsComputedFacets(
  tx: Prisma.TransactionClient,
  input: OprsSqlInput & { column: string; q: string; limit: number },
  ctx: OprsSqlContext,
): Promise<FacetResponse> {
  const take = Math.min(500, Math.max(1, input.limit));
  const query = buildOprsFacetSql(input, ctx, input.column, input.q, take);
  const grouped = await tx.$queryRaw<Array<{ value: string | null; count: unknown }>>(
    query,
  );
  const items = grouped.slice(0, take).map((row) => ({
    value: toFilterToken(row.value == null ? "" : String(row.value)),
    count: asCount(row.count),
  }));
  return {
    items: arrangeTrafficFacetItems(input.column, items),
    truncated: grouped.length > take,
  };
}
