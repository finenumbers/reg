/**
 * Phone traffic query — local CDR table.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  toFilterToken,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import { getJobRunSummary } from "@/modules/jobs/query";
import { countInboxFiles } from "@/modules/traffic/inbox";
import { isSafeVoipmonitorHref } from "@/modules/voipmonitor/url";
import {
  CDR_COLUMNS,
  CDR_ENRICH_COLUMNS,
  CDR_PHONE_COLUMNS,
  csvHeaderToCamel,
  isTrafficColumn,
} from "@/modules/traffic/columns";

export type TrafficListItem = {
  id: string;
  cdrAt: string | null;
  data: Record<string, string>;
};

export type ListTrafficResult = {
  items: TrafficListItem[];
  headers: string[];
  total: number;
  page: number;
  pageSize: number;
};

export type TrafficOperationalStatus = {
  lastJobStatus: "success" | "failed" | "running" | "never" | null;
  lastError: string | null;
  lastFinishedAt: string | null;
  lastFailedError: string | null;
  runningCount: number;
  recordCount: number;
  pendingInboxCount: number;
  poisonedCount: number;
};

function rowToData(
  row: Record<string, unknown>,
  link?: { voipmonitorUrl: string; voipmonitorCdrId: string } | null,
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const col of CDR_COLUMNS) {
    const value = row[csvHeaderToCamel(col)];
    data[col] = value == null ? "" : String(value);
  }
  for (const col of CDR_ENRICH_COLUMNS) {
    const value = row[csvHeaderToCamel(col)];
    data[col] = value == null ? "" : String(value);
  }
  data.voipmonitor_url = link?.voipmonitorUrl ?? "";
  data.voipmonitor_cdr_id = link?.voipmonitorCdrId ?? "";
  return data;
}

function applyColumnFilters(
  base: Prisma.CdrRecordWhereInput,
  filters: ColumnFilters,
  opts: { excludeColumn?: string } = {},
): Prisma.CdrRecordWhereInput {
  const extras: Prisma.CdrRecordWhereInput[] = [];
  for (const [column, values] of Object.entries(filters)) {
    if (opts.excludeColumn && column === opts.excludeColumn) continue;
    if (!values?.length || !isTrafficColumn(column)) continue;
    const field = csvHeaderToCamel(column);
    extras.push({
      OR: values.map((raw) => ({
        [field]: raw === EMPTY_FILTER_TOKEN ? "" : raw,
      })),
    });
  }
  if (extras.length === 0) return base;
  return { AND: [base, ...extras] };
}

function applyPhoneQ(
  base: Prisma.CdrRecordWhereInput,
  phoneQ: string,
): Prisma.CdrRecordWhereInput {
  const q = phoneQ.trim();
  if (!q) return base;
  return {
    AND: [
      base,
      {
        OR: CDR_PHONE_COLUMNS.map((col) => ({
          [csvHeaderToCamel(col)]: { contains: q },
        })),
      },
    ],
  };
}

function buildWhere(
  filters: ColumnFilters,
  phoneQ: string,
  opts: { excludeColumn?: string } = {},
): Prisma.CdrRecordWhereInput {
  return applyPhoneQ(applyColumnFilters({}, filters, opts), phoneQ);
}

export async function listTraffic(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListTrafficResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 100));
  const filters = opts.filters ?? {};
  const phoneQ = opts.phoneQ?.trim() ?? "";
  const where = buildWhere(filters, phoneQ);
  const skip = (page - 1) * pageSize;

  const [total, rows] = await Promise.all([
    prisma.cdrRecord.count({ where }),
    prisma.cdrRecord.findMany({
      where,
      orderBy: [{ cdrAt: "desc" }, { cdrId: "desc" }],
      skip,
      take: pageSize,
    }),
  ]);

  const [links, guiSetting] =
    rows.length === 0
      ? [[], null]
      : await Promise.all([
          prisma.cdrVoipmonitorLink.findMany({
            where: { cdrRecordId: { in: rows.map((row) => row.id) } },
            select: {
              cdrRecordId: true,
              voipmonitorUrl: true,
              voipmonitorCdrId: true,
            },
          }),
          prisma.appSetting.findUnique({
            where: { id: 1 },
            select: { voipmonitorGuiUrl: true },
          }),
        ]);
  const guiUrl = guiSetting?.voipmonitorGuiUrl?.trim() ?? "";
  const linkById = new Map(
    links.map((link) => [
      link.cdrRecordId,
      {
        ...link,
        voipmonitorUrl:
          guiUrl && isSafeVoipmonitorHref(link.voipmonitorUrl, guiUrl)
            ? link.voipmonitorUrl
            : "",
      },
    ]),
  );

  return {
    items: rows.map((row) => ({
      id: row.id,
      cdrAt: row.cdrAt?.toISOString() ?? null,
      data: rowToData(
        row as unknown as Record<string, unknown>,
        linkById.get(row.id),
      ),
    })),
    headers: [...CDR_COLUMNS],
    total,
    page,
    pageSize,
  };
}

export async function listTrafficFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  const column = opts.column.trim();
  if (!isTrafficColumn(column)) {
    return { items: [], truncated: false };
  }
  const field = csvHeaderToCamel(column);
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const phoneQ = opts.phoneQ?.trim() ?? "";
  const q = opts.q?.trim() ?? "";
  const where = buildWhere(opts.filters ?? {}, phoneQ, {
    excludeColumn: column,
  });
  const fieldWhere: Prisma.CdrRecordWhereInput = q
    ? { AND: [where, { [field]: { contains: q } }] }
    : where;

  const grouped = await prisma.cdrRecord.groupBy({
    by: [field as Prisma.CdrRecordScalarFieldEnum],
    where: fieldWhere,
    _count: true,
    orderBy: { _count: { id: "desc" } },
    take: limit + 1,
  });

  const items = grouped.map((row) => {
    const raw = (row as Record<string, unknown>)[field];
    return {
      value: toFilterToken(raw == null ? "" : String(raw)),
      count: row._count,
    };
  });
  return {
    items: items.slice(0, limit),
    truncated: grouped.length > limit,
  };
}

export async function getTrafficStatus(): Promise<TrafficOperationalStatus> {
  const [summary, recordCount, inbox] = await Promise.all([
    getJobRunSummary("cdr.import"),
    prisma.cdrRecord.count(),
    countInboxFiles(),
  ]);
  const last = summary.lastAny;
  return {
    lastJobStatus: last
      ? last.status
      : summary.runningCount > 0
        ? "running"
        : "never",
    lastError: last?.status === "failed" ? last.errorMessage : null,
    lastFinishedAt: last?.finishedAt ?? null,
    lastFailedError: summary.lastFailed?.errorMessage ?? null,
    runningCount: summary.runningCount,
    recordCount,
    pendingInboxCount: inbox.pending,
    poisonedCount: inbox.poisoned,
  };
}
