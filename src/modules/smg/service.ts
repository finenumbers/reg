import { Prisma, type JobStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import {
  EMPTY_FILTER_TOKEN,
  facetQueryMatchesEmptyLabel,
  toFilterToken,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import {
  currentUtcMonth,
  resolveMonthKey,
  withCurrentMonth,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";
import {
  assertSmgExportRowCount,
  SMG_EXPORT_PAGE_SIZE,
  writeSmgExportFile,
  type SmgExportLayout,
} from "@/modules/smg/xlsx-export";
import {
  isSmgField,
  SMG_FIELDS,
  SMG_PHONE_FIELDS,
  type SmgField,
} from "@/modules/smg/columns";
import { pickSmgDevice, type SmgDeviceOption } from "@/modules/smg/device";
import {
  AF_CATEGORY,
  AF_STATUS,
  classifyAntifraud,
} from "@/modules/smg-trace/classify";
import { decideTraceRows, type TraceHitRow } from "@/modules/smg-trace/match";
import { traceSearchKeys } from "@/modules/smg-trace/tag";
import type { TraceBlocks } from "@/modules/smg-trace/types";
import { smgMonthTimeRange } from "@/modules/smg/month-range";
import { listSmgPoisonEntries, type SmgPoisonItem } from "@/modules/smg/poison";
import { findLastFileImport } from "@/modules/jobs/last-file-import";
import { lastSmgEmptyScanAt } from "@/modules/jobs/scheduler";

export type SmgListItem = Record<SmgField, string> & {
  id: string;
  antifraud: string;
  antifraudStatus: string;
};

export type SmgListResult = {
  items: SmgListItem[];
  total: number;
  page: number;
  pageSize: number;
  month: string;
  months: CdrMonth[];
  device: string;
  /** Null when this response did not recount the gateway menu. */
  devices: SmgDeviceOption[] | null;
  poisonFiles: SmgPoisonItem[];
};

type MonthCountRow = { key: string; count: number };

function monthWhere(month: CdrMonth): Prisma.SmgCdrRecordWhereInput {
  const range = smgMonthTimeRange(month);
  return { disconnectTime: { gte: range.gte, lt: range.lt } };
}

function applyColumnFilters(
  base: Prisma.SmgCdrRecordWhereInput,
  filters: ColumnFilters,
  opts: { excludeColumn?: string } = {},
): Prisma.SmgCdrRecordWhereInput {
  const extras: Prisma.SmgCdrRecordWhereInput[] = [];
  for (const [column, values] of Object.entries(filters)) {
    if (column === "deviceSign") continue;
    if (opts.excludeColumn && column === opts.excludeColumn) continue;
    if (!values?.length || !isSmgField(column)) continue;
    extras.push({
      OR: values.map((raw) => ({
        [column]: raw === EMPTY_FILTER_TOKEN ? "" : raw,
      })),
    });
  }
  if (extras.length === 0) return base;
  return { AND: [base, ...extras] };
}

function applyPhoneQ(
  base: Prisma.SmgCdrRecordWhereInput,
  phoneQ: string,
): Prisma.SmgCdrRecordWhereInput {
  const q = phoneQ.trim();
  if (!q) return base;
  return {
    AND: [
      base,
      {
        OR: SMG_PHONE_FIELDS.map((field) => ({
          [field]: { contains: q, mode: "insensitive" as const },
        })),
      },
    ],
  };
}

function applyDevice(
  base: Prisma.SmgCdrRecordWhereInput,
  device: string,
): Prisma.SmgCdrRecordWhereInput {
  // Stored ids are cuids. An empty id matches nothing when the month has no gateway.
  if (!device) return { AND: [base, { id: "" }] };
  return { AND: [base, { deviceSign: device }] };
}

function buildWhere(
  month: CdrMonth,
  device: string,
  filters: ColumnFilters,
  phoneQ: string,
  opts: { excludeColumn?: string } = {},
): Prisma.SmgCdrRecordWhereInput {
  return applyPhoneQ(
    applyColumnFilters(applyDevice(monthWhere(month), device), filters, opts),
    phoneQ,
  );
}

async function querySmgDevices(month: CdrMonth): Promise<SmgDeviceOption[]> {
  const range = smgMonthTimeRange(month);
  const grouped = await prisma.smgCdrRecord.groupBy({
    by: ["deviceSign"],
    where: {
      disconnectTime: { gte: range.gte, lt: range.lt },
      deviceSign: { not: "" },
    },
    _count: { id: true },
    orderBy: { deviceSign: "asc" },
  });
  return grouped.map((row) => ({ sign: row.deviceSign, count: row._count.id }));
}

export async function querySmgMonthCounts(): Promise<CdrMonth[]> {
  if (isDatabaseVacuumActive()) return [];
  const rows = await prisma.$queryRaw<MonthCountRow[]>`
    SELECT left(disconnect_day, 7) AS key, COUNT(*)::int AS count
    FROM smg_cdr_records
    WHERE disconnect_day <> ''
    GROUP BY 1
    ORDER BY 1 DESC
  `;
  const current = currentUtcMonth();
  return withCurrentMonth(
    rows.flatMap((row) => {
      const parsed = resolveMonthKey(row.key);
      if (parsed.key !== row.key) return [];
      return [{ ...parsed, count: row.count }];
    }),
    current,
  );
}

function toListItem(row: { id: string } & Record<SmgField, string>): SmgListItem {
  const item = { id: row.id } as SmgListItem;
  for (const field of SMG_FIELDS) item[field] = row[field] ?? "";
  item.antifraud = AF_CATEGORY.noData;
  item.antifraudStatus = AF_STATUS.unknown;
  return item;
}

/** One query for the page. Two cards for one tag are left unresolved. */
async function attachAntifraud(items: SmgListItem[]): Promise<void> {
  if (items.length === 0) return;
  const keysByItem = new Map<string, string[]>();
  const allKeys = new Set<string>();
  for (const item of items) {
    const keys = traceSearchKeys(item.uniqueTag, item.radiusSessionId);
    keysByItem.set(item.id, keys);
    for (const key of keys) allKeys.add(key);
  }
  if (allKeys.size === 0) return;

  const rows = await prisma.smgCallTrace.findMany({
    where: { tagNorm: { in: [...allKeys] } },
    select: { tagNorm: true, deviceIp: true, open: true, callref: true, blocks: true },
  });
  const byTag = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byTag.get(row.tagNorm) ?? [];
    list.push(row);
    byTag.set(row.tagNorm, list);
  }

  for (const item of items) {
    const hits: TraceHitRow[] = [];
    const seen = new Set<string>();
    for (const key of keysByItem.get(item.id) ?? []) {
      for (const row of byTag.get(key) ?? []) {
        const id = `${row.deviceIp}\0${row.callref}`;
        if (seen.has(id) || !isTraceBlocks(row.blocks)) continue;
        seen.add(id);
        hits.push({
          deviceIp: row.deviceIp,
          open: row.open,
          callref: row.callref,
          blocks: row.blocks,
        });
      }
    }
    const decision = decideTraceRows(hits);
    if (decision.status === "ambiguous") {
      item.antifraud = AF_CATEGORY.conflict;
      item.antifraudStatus = AF_STATUS.unknown;
      continue;
    }
    if (decision.status !== "ok") continue;
    const labels = classifyAntifraud({ closed: !decision.open, blocks: decision.blocks });
    item.antifraud = labels.category;
    item.antifraudStatus = labels.status;
  }
}

function isTraceBlocks(value: unknown): value is TraceBlocks {
  if (!value || typeof value !== "object") return false;
  const row = value as { antifraud?: unknown };
  return row.antifraud != null && typeof row.antifraud === "object";
}

export async function listSmgCalls(input: {
  month?: string;
  page?: number;
  phoneQ?: string;
  filters?: ColumnFilters;
  device?: string;
  includeDevices?: boolean;
}): Promise<SmgListResult> {
  const month = resolveMonthKey(input.month);
  const page = Math.max(1, input.page ?? 1);
  const poisonFiles = listSmgPoisonEntries();
  const requested = input.device?.trim() ?? "";
  const includeDevices = input.includeDevices === true || requested === "";
  if (isDatabaseVacuumActive()) {
    return {
      items: [],
      total: 0,
      page,
      pageSize: TABLE_PAGE_SIZE,
      month: month.key,
      months: [currentUtcMonth()],
      device: "",
      devices: includeDevices ? [] : null,
      poisonFiles,
    };
  }

  const devices = includeDevices ? await querySmgDevices(month) : null;
  const device = includeDevices ? pickSmgDevice(devices ?? [], requested) : requested;
  const where = buildWhere(month, device, input.filters ?? {}, input.phoneQ ?? "");
  const [total, rows, months] = await Promise.all([
    prisma.smgCdrRecord.count({ where }),
    prisma.smgCdrRecord.findMany({
      where,
      orderBy: [{ disconnectTime: "desc" }, { id: "desc" }],
      skip: (page - 1) * TABLE_PAGE_SIZE,
      take: TABLE_PAGE_SIZE,
    }),
    page === 1 ? querySmgMonthCounts() : Promise.resolve([]),
  ]);

  const items = rows.map((row) => toListItem(row));
  await attachAntifraud(items);
  return {
    items,
    total,
    page,
    pageSize: TABLE_PAGE_SIZE,
    month: month.key,
    months,
    device,
    devices,
    poisonFiles,
  };
}

/**
 * The rows behind «Сохранить данные». Same where-clause and order as the table.
 * An empty gateway writes headers only.
 */
export async function writeSmgExport(input: {
  month: CdrMonth;
  device: string;
  phoneQ: string;
  filters: ColumnFilters;
  layout: SmgExportLayout;
  filePath: string;
}): Promise<number> {
  const device = input.device.trim();
  if (!device) {
    return writeSmgExportFile({
      layout: input.layout,
      filePath: input.filePath,
      eachRow: async () => {},
    });
  }
  const where = buildWhere(input.month, device, input.filters, input.phoneQ);
  const total = await prisma.smgCdrRecord.count({ where });
  assertSmgExportRowCount(total);
  return writeSmgExportFile({
    layout: input.layout,
    filePath: input.filePath,
    eachRow: async (visit) => {
      for (let skip = 0; skip < total; skip += SMG_EXPORT_PAGE_SIZE) {
        const rows = await prisma.smgCdrRecord.findMany({
          where,
          orderBy: [{ disconnectTime: "desc" }, { id: "desc" }],
          skip,
          take: SMG_EXPORT_PAGE_SIZE,
        });
        const items = rows.map((row) => toListItem(row));
        await attachAntifraud(items);
        for (const item of items) await visit(item);
      }
    },
  });
}

export async function listSmgFacets(input: {
  column: string;
  month?: string;
  phoneQ?: string;
  filters?: ColumnFilters;
  device?: string;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  const device = input.device?.trim() ?? "";
  if (!isSmgField(input.column) || !device || isDatabaseVacuumActive()) {
    return { items: [], truncated: false };
  }
  const month = resolveMonthKey(input.month);
  const limit = Math.min(200, Math.max(1, input.limit ?? 200));
  const q = input.q?.trim() ?? "";
  let where = buildWhere(month, device, input.filters ?? {}, input.phoneQ ?? "", {
    excludeColumn: input.column,
  });
  if (q) {
    const valueWhere: Prisma.SmgCdrRecordWhereInput = facetQueryMatchesEmptyLabel(q)
      ? {
          OR: [
            { [input.column]: { contains: q, mode: "insensitive" } },
            { [input.column]: "" },
          ],
        }
      : { [input.column]: { contains: q, mode: "insensitive" } };
    where = { AND: [where, valueWhere] };
  }

  const column = input.column;
  const grouped = await prisma.smgCdrRecord.groupBy({
    by: [column as Prisma.SmgCdrRecordScalarFieldEnum],
    where,
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: limit + 1,
  });
  const truncated = grouped.length > limit;
  const items = grouped.slice(0, limit).map((row) => {
    const raw = (row as Record<string, unknown>)[column];
    return {
      value: toFilterToken(raw == null ? "" : String(raw)),
      count: row._count.id,
    };
  });
  return { items, truncated };
}

export type SmgStatus = {
  cursor: string | null;
  changed: boolean;
  poisonFiles: SmgPoisonItem[];
  lastPassAt: string | null;
  hadCalls: boolean;
  lastCheckedAt: string | null;
};

const SMG_IMPORT_DONE: JobStatus[] = ["success", "failed"];

const SMG_IMPORT_MEANINGFUL: Prisma.JobRunWhereInput = {
  OR: [{ phonesParsed: { gt: 0 } }, { linesBad: { gt: 0 } }],
};

/**
 * Id of the latest completed smg.import. Read this before listing calls so a
 * job that finishes afterwards is still visible to the next status poll.
 */
export async function latestSmgImportCursor(): Promise<string | null> {
  const latest = await prisma.jobRun.findFirst({
    where: { actionCode: "smg.import", status: { in: SMG_IMPORT_DONE } },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  return latest?.id ?? null;
}

/**
 * Latest completed smg.import, and whether a job after `sinceId` wrote rows
 * or bad lines. An unknown id is an empty cursor: changed stays false.
 * `baselineEmpty` is a page rendered before any completed import. Then any
 * later meaningful job counts, including one that was already running.
 * Comparison uses the stored startedAt, not a rounded timestamp.
 */
export async function getSmgStatus(
  sinceId?: string | null,
  opts?: { baselineEmpty?: boolean },
): Promise<SmgStatus> {
  const poisonFiles = listSmgPoisonEntries();
  const id = sinceId?.trim() || null;
  const [latest, cursorJob, filePass] = await Promise.all([
    prisma.jobRun.findFirst({
      where: { actionCode: "smg.import", status: { in: SMG_IMPORT_DONE } },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    }),
    id
      ? prisma.jobRun.findFirst({
          where: { id, actionCode: "smg.import" },
          select: { id: true, startedAt: true },
        })
      : Promise.resolve(null),
    findLastFileImport("smg.import"),
  ]);

  let changed = false;
  if (cursorJob) {
    const meaningful = await prisma.jobRun.findFirst({
      where: {
        actionCode: "smg.import",
        status: { in: SMG_IMPORT_DONE },
        id: { not: cursorJob.id },
        startedAt: { gte: cursorJob.startedAt },
        ...SMG_IMPORT_MEANINGFUL,
      },
      select: { id: true },
    });
    changed = meaningful != null;
  } else if (opts?.baselineEmpty && !id) {
    const meaningful = await prisma.jobRun.findFirst({
      where: {
        actionCode: "smg.import",
        status: { in: SMG_IMPORT_DONE },
        ...SMG_IMPORT_MEANINGFUL,
      },
      select: { id: true },
    });
    changed = meaningful != null;
  }

  const checkedAt = lastSmgEmptyScanAt();
  return {
    cursor: latest?.id ?? null,
    changed,
    poisonFiles,
    lastPassAt: filePass.lastPassAt,
    hadCalls: filePass.hadCalls,
    lastCheckedAt: checkedAt == null ? null : new Date(checkedAt).toISOString(),
  };
}
