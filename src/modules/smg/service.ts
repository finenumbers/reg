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
import {
  querySmgFacetValues,
  querySmgIdPage,
  smgFacetNeedsSql,
  smgListNeedsSql,
} from "@/modules/smg/call-query";
import {
  foldSmgDevices,
  pickSmgDevice,
  SMG_NO_DATA_DEVICE,
  SMG_NO_DATA_LABEL,
  smgDeviceSigns,
  type SmgDeviceOption,
  type SmgNodeName,
  type SmgSignCount,
} from "@/modules/smg/device";
import { smgNodeAntifraudOff } from "@/modules/smg/antifraud-gate";
import {
  maskDisabledAntifraud,
  NO_ANTIFRAUD_LABEL,
  NO_TRACE_LABELS,
  resolveStoredTraces,
} from "@/modules/smg/row-tokens";
import {
  AF_CATEGORY,
  AF_STATUS,
  classifyAntifraud,
  SMG_RADIUS_DELAY_COLUMNS,
} from "@/modules/smg-trace/classify";
import { radiusDelayCells, type RadiusDelayCells } from "@/modules/smg-trace/summary";
import { traceSearchKeys } from "@/modules/smg-trace/tag";
import type { TraceBlocks } from "@/modules/smg-trace/types";
import type { TimeSort } from "@/modules/traffic/traffic-sort";
import { cdrLabelsReady } from "@/modules/smg/cdr-labels";
import { smgMonthTimeRange } from "@/modules/smg/month-range";
import { listSmgPoisonEntries, type SmgPoisonItem } from "@/modules/smg/poison";
import { findLastFileImport } from "@/modules/jobs/last-file-import";
import { lastSmgEmptyScanAt } from "@/modules/jobs/scheduler";

export type SmgListItem = Record<SmgField, string> &
  RadiusDelayCells & {
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

const STORED_AF = {
  antifraud: "afCategory",
  antifraudStatus: "afStatus",
} as const;

async function readAntifraudMode(
  device: string,
  filters: ColumnFilters,
): Promise<{ off: boolean; empty: boolean; filters: ColumnFilters }> {
  if (!device || !(await smgNodeAntifraudOff(device))) {
    return { off: false, empty: false, filters };
  }
  const masked = maskDisabledAntifraud(filters);
  return { off: true, empty: masked.empty, filters: masked.filters };
}

function paintNoAntifraud(items: SmgListItem[]): void {
  const delays = radiusDelayCells("");
  for (const item of items) {
    item.antifraud = NO_ANTIFRAUD_LABEL;
    item.antifraudStatus = NO_ANTIFRAUD_LABEL;
    Object.assign(item, delays);
  }
}

function filtersTouchAf(filters: ColumnFilters): boolean {
  return (
    (filters.antifraud?.length ?? 0) > 0 || (filters.antifraudStatus?.length ?? 0) > 0
  );
}

function applyStoredAfFilters(
  base: Prisma.SmgCdrRecordWhereInput,
  filters: ColumnFilters,
  opts: { excludeColumn?: string; storedAf?: boolean },
): Prisma.SmgCdrRecordWhereInput {
  if (!opts.storedAf) return base;
  const extras: Prisma.SmgCdrRecordWhereInput[] = [];
  for (const [column, field] of Object.entries(STORED_AF)) {
    if (opts.excludeColumn === column) continue;
    const values = filters[column];
    if (!values?.length) continue;
    extras.push({
      OR: values.map((raw) => ({
        [field]: raw === EMPTY_FILTER_TOKEN ? "" : raw,
      })),
    });
  }
  if (extras.length === 0) return base;
  return { AND: [base, ...extras] };
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

function applyDeviceSigns(
  base: Prisma.SmgCdrRecordWhereInput,
  signs: readonly string[],
): Prisma.SmgCdrRecordWhereInput {
  // Stored ids are cuids. An empty id matches nothing when the month has no gateway.
  if (signs.length === 0) return { AND: [base, { id: "" }] };
  if (signs.length === 1) return { AND: [base, { deviceSign: signs[0] }] };
  return { AND: [base, { deviceSign: { in: [...signs] } }] };
}

function buildWhere(
  month: CdrMonth,
  signs: readonly string[],
  filters: ColumnFilters,
  phoneQ: string,
  opts: { excludeColumn?: string; storedAf?: boolean } = {},
): Prisma.SmgCdrRecordWhereInput {
  return applyPhoneQ(
    applyStoredAfFilters(
      applyColumnFilters(applyDeviceSigns(monthWhere(month), signs), filters, opts),
      filters,
      opts,
    ),
    phoneQ,
  );
}

type SignCache = { key: string; groups: SmgSignCount[] };

let signCache: SignCache | null = null;

export function resetSmgDeviceCacheForTests(): void {
  signCache = null;
}

async function loadSmgNodeNames(): Promise<SmgNodeName[]> {
  return prisma.smgSyslogNode.findMany({
    orderBy: { name: "asc" },
    select: { identifier: true, name: true, cdrTimezone: true },
  });
}

async function monthSignGroups(month: CdrMonth, refresh: boolean): Promise<SmgSignCount[]> {
  if (isDatabaseVacuumActive()) return [];
  const cursor = await latestSmgImportCursor();
  const key = `${month.key}\n${cursor ?? ""}`;
  if (!refresh && signCache?.key === key) return signCache.groups;
  const range = smgMonthTimeRange(month);
  const grouped = await prisma.smgCdrRecord.groupBy({
    by: ["deviceSign"],
    where: { disconnectTime: { gte: range.gte, lt: range.lt } },
    _count: { id: true },
  });
  const groups = grouped.map((row) => ({ sign: row.deviceSign, count: row._count.id }));
  signCache = { key, groups };
  return groups;
}

async function resolveDeviceSigns(month: CdrMonth, device: string): Promise<string[]> {
  const [groups, nodes] = await Promise.all([
    monthSignGroups(month, false),
    loadSmgNodeNames(),
  ]);
  return smgDeviceSigns(groups, nodes, device);
}

/** Download name for the selected menu value. An unknown value adds no node. */
export async function smgDeviceFileLabel(device: string): Promise<string> {
  const id = device.trim();
  if (id === SMG_NO_DATA_DEVICE) return SMG_NO_DATA_LABEL;
  if (!id) return "";
  const nodes = await loadSmgNodeNames();
  return nodes.find((node) => node.identifier === id)?.name ?? "";
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

function toListItem(
  row: { id: string; afCategory?: string | null; afStatus?: string | null } & Record<
    SmgField,
    string
  >,
  keepStored: boolean,
): SmgListItem {
  const item = { id: row.id } as SmgListItem;
  for (const field of SMG_FIELDS) item[field] = row[field] ?? "";
  if (keepStored && row.afCategory && row.afStatus) {
    item.antifraud = row.afCategory;
    item.antifraudStatus = row.afStatus;
  } else {
    item.antifraud = AF_CATEGORY.noData;
    item.antifraudStatus = AF_STATUS.unknown;
  }
  Object.assign(item, radiusDelayCells(""));
  return item;
}

type TraceLabelRow = {
  id: string;
  tagNorm: string;
  afCategory: string | null;
  afStatus: string | null;
};

function queryRaw<T>(query: Prisma.Sql): Promise<T> {
  return prisma.$queryRaw<T>(query);
}

function smgOrder(sort: TimeSort | null): Prisma.SmgCdrRecordOrderByWithRelationInput[] {
  if (sort === "asc") return [{ setupTime: "asc" }, { id: "asc" }];
  if (sort === "desc") return [{ setupTime: "desc" }, { id: "desc" }];
  return [{ disconnectTime: "desc" }, { id: "desc" }];
}

async function readSmgSlice(input: {
  where: Prisma.SmgCdrRecordWhereInput;
  useSql: boolean;
  month: CdrMonth;
  deviceSigns: readonly string[];
  phoneQ: string;
  filters: ColumnFilters;
  setupSort: TimeSort | null;
  skip: number;
  take: number;
  storedAf: boolean;
}): Promise<Awaited<ReturnType<typeof prisma.smgCdrRecord.findMany>>> {
  if (!input.useSql) {
    return prisma.smgCdrRecord.findMany({
      where: input.where,
      orderBy: smgOrder(input.setupSort),
      skip: input.skip,
      take: input.take,
    });
  }
  const slice = await querySmgIdPage(
    queryRaw,
    {
      month: input.month,
      deviceSigns: input.deviceSigns,
      phoneQ: input.phoneQ,
      filters: input.filters,
      setupSort: input.setupSort,
      skip: input.skip,
      take: input.take,
      storedAf: input.storedAf,
    },
    labelsForTraceIds,
  );
  if (slice.ids.length === 0) return [];
  const found = await prisma.smgCdrRecord.findMany({ where: { id: { in: slice.ids } } });
  return orderByIds(slice.ids, found);
}

function orderByIds<T extends { id: string }>(ids: string[], rows: T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/** Classify cards that have no stored label. The request does not write them. */
async function labelsForTraceIds(
  ids: string[],
): Promise<Map<string, { category: string; status: string }>> {
  const out = new Map<string, { category: string; status: string }>();
  if (ids.length === 0) return out;
  const rows = await prisma.smgCallTrace.findMany({
    where: { id: { in: ids } },
    select: { id: true, open: true, blocks: true },
  });
  for (const row of rows) {
    const labels = isTraceBlocks(row.blocks)
      ? classifyAntifraud({ closed: !row.open, blocks: row.blocks })
      : NO_TRACE_LABELS;
    out.set(row.id, labels);
  }
  return out;
}

type TraceCardRead = {
  category: string;
  status: string;
  delays: RadiusDelayCells;
};

/** One card's text. Labels fill a row that has none stored. Delays always do. */
async function readTraceCards(ids: string[]): Promise<Map<string, TraceCardRead>> {
  const out = new Map<string, TraceCardRead>();
  if (ids.length === 0) return out;
  const rows = await prisma.smgCallTrace.findMany({
    where: { id: { in: ids } },
    select: { id: true, open: true, blocks: true },
  });
  for (const row of rows) {
    if (!isTraceBlocks(row.blocks)) {
      out.set(row.id, { ...NO_TRACE_LABELS, delays: radiusDelayCells("") });
      continue;
    }
    const labels = classifyAntifraud({ closed: !row.open, blocks: row.blocks });
    out.set(row.id, { ...labels, delays: radiusDelayCells(row.blocks.text) });
  }
  return out;
}

/** One query for the page. Two cards for one tag stay unresolved. */
async function attachAntifraud(
  items: SmgListItem[],
  keepStoredLabels = false,
): Promise<void> {
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
    select: { id: true, tagNorm: true, afCategory: true, afStatus: true },
  });
  const byTag = new Map<string, TraceLabelRow[]>();
  for (const row of rows) {
    const list = byTag.get(row.tagNorm) ?? [];
    list.push(row);
    byTag.set(row.tagNorm, list);
  }

  const queued: { item: SmgListItem; traceId: string; fillLabels: boolean }[] = [];
  for (const item of items) {
    const hits: TraceLabelRow[] = [];
    const seen = new Set<string>();
    for (const key of keysByItem.get(item.id) ?? []) {
      for (const row of byTag.get(key) ?? []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        hits.push(row);
      }
    }
    if (hits.length === 0) continue;
    if (hits.length > 1) {
      if (!keepStoredLabels) {
        item.antifraud = AF_CATEGORY.conflict;
        item.antifraudStatus = AF_STATUS.unknown;
      }
      continue;
    }
    const hit = hits[0]!;
    const resolved = resolveStoredTraces([
      { id: hit.id, category: hit.afCategory, status: hit.afStatus },
    ]);
    if (resolved.kind === "ready") {
      if (!keepStoredLabels) {
        item.antifraud = resolved.category;
        item.antifraudStatus = resolved.status;
      }
      queued.push({ item, traceId: hit.id, fillLabels: false });
      continue;
    }
    if (resolved.kind === "pending") {
      queued.push({ item, traceId: hit.id, fillLabels: !keepStoredLabels });
    }
  }
  if (queued.length === 0) return;
  const cards = await readTraceCards([...new Set(queued.map((row) => row.traceId))]);
  for (const row of queued) {
    const card = cards.get(row.traceId);
    if (!card) continue;
    if (row.fillLabels) {
      row.item.antifraud = card.category;
      row.item.antifraudStatus = card.status;
    }
    for (const column of SMG_RADIUS_DELAY_COLUMNS) {
      row.item[column] = card.delays[column];
    }
  }
}

function isTraceBlocks(value: unknown): value is TraceBlocks {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { text?: unknown }).text === "string";
}

export async function listSmgCalls(input: {
  month?: string;
  page?: number;
  phoneQ?: string;
  filters?: ColumnFilters;
  device?: string;
  includeDevices?: boolean;
  setupSort?: TimeSort | null;
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

  const [groups, nodes] = await Promise.all([
    monthSignGroups(month, includeDevices),
    loadSmgNodeNames(),
  ]);
  const devices = includeDevices ? foldSmgDevices(groups, nodes) : null;
  const device = includeDevices ? pickSmgDevice(devices ?? [], requested) : requested;
  const signs = smgDeviceSigns(groups, nodes, device);
  const mode = await readAntifraudMode(device, input.filters ?? {});
  if (mode.off && mode.empty) {
    return {
      items: [],
      total: 0,
      page,
      pageSize: TABLE_PAGE_SIZE,
      month: month.key,
      months: page === 1 ? await querySmgMonthCounts() : [],
      device,
      devices,
      poisonFiles,
    };
  }
  const filters = mode.filters;
  const phoneQ = input.phoneQ ?? "";
  const setupSort = input.setupSort ?? null;
  const storedAf =
    signs.length > 0 && filtersTouchAf(filters)
      ? await cdrLabelsReady(month, signs)
      : false;
  const where = buildWhere(month, signs, filters, phoneQ, { storedAf });
  const useSql = signs.length > 0 && smgListNeedsSql(filters, storedAf);
  let total: number;
  let rows: Awaited<ReturnType<typeof prisma.smgCdrRecord.findMany>>;
  let months: CdrMonth[];
  const slice = {
    where,
    useSql,
    month,
    deviceSigns: signs,
    phoneQ,
    filters,
    setupSort,
    storedAf,
  };
  if (useSql) {
    const counted = await querySmgIdPage(
      queryRaw,
      {
        month,
        deviceSigns: signs,
        phoneQ,
        filters,
        setupSort,
        skip: 0,
        take: 1,
        storedAf,
      },
      labelsForTraceIds,
    );
    total = counted.total;
    rows = await readSmgSlice({
      ...slice,
      skip: (page - 1) * TABLE_PAGE_SIZE,
      take: TABLE_PAGE_SIZE,
    });
    months = page === 1 ? await querySmgMonthCounts() : [];
  } else {
    [total, rows, months] = await Promise.all([
      prisma.smgCdrRecord.count({ where }),
      readSmgSlice({
        ...slice,
        skip: (page - 1) * TABLE_PAGE_SIZE,
        take: TABLE_PAGE_SIZE,
      }),
      page === 1 ? querySmgMonthCounts() : Promise.resolve([]),
    ]);
  }

  const items = rows.map((row) => toListItem(row, storedAf));
  if (mode.off) paintNoAntifraud(items);
  else await attachAntifraud(items, storedAf);
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
  setupSort?: TimeSort | null;
  layout: SmgExportLayout;
  filePath: string;
}): Promise<number> {
  const device = input.device.trim();
  const signs = await resolveDeviceSigns(input.month, device);
  const mode = await readAntifraudMode(device, input.filters);
  if (signs.length === 0 || mode.empty) {
    return writeSmgExportFile({
      layout: input.layout,
      filePath: input.filePath,
      eachRow: async () => {},
    });
  }
  const exportFilters = mode.filters;
  const storedAf = filtersTouchAf(exportFilters)
    ? await cdrLabelsReady(input.month, signs)
    : false;
  const where = buildWhere(input.month, signs, exportFilters, input.phoneQ, {
    storedAf,
  });
  const setupSort = input.setupSort ?? null;
  const useSql = smgListNeedsSql(exportFilters, storedAf);
  const total = useSql
    ? (
        await querySmgIdPage(
          queryRaw,
          {
            month: input.month,
            deviceSigns: signs,
            phoneQ: input.phoneQ,
            filters: exportFilters,
            setupSort,
            skip: 0,
            take: 1,
            storedAf,
          },
          labelsForTraceIds,
        )
      ).total
    : await prisma.smgCdrRecord.count({ where });
  assertSmgExportRowCount(total);
  return writeSmgExportFile({
    layout: input.layout,
    filePath: input.filePath,
    eachRow: async (visit) => {
      for (let skip = 0; skip < total; skip += SMG_EXPORT_PAGE_SIZE) {
        const rows = await readSmgSlice({
          where,
          useSql,
          month: input.month,
          deviceSigns: signs,
          phoneQ: input.phoneQ,
          filters: exportFilters,
          setupSort,
          storedAf,
          skip,
          take: SMG_EXPORT_PAGE_SIZE,
        });
        const items = rows.map((row) => toListItem(row, storedAf));
        if (mode.off) paintNoAntifraud(items);
        else await attachAntifraud(items, storedAf);
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
  const derived =
    input.column === "setupDay" ||
    input.column === "redirectNumber" ||
    input.column === "antifraud" ||
    input.column === "antifraudStatus";
  if ((!isSmgField(input.column) && !derived) || !device || isDatabaseVacuumActive()) {
    return { items: [], truncated: false };
  }
  const month = resolveMonthKey(input.month);
  const limit = Math.min(200, Math.max(1, input.limit ?? 200));
  const q = input.q?.trim() ?? "";
  const requestedFilters = input.filters ?? {};
  const mode = await readAntifraudMode(device, requestedFilters);
  if (mode.off && (input.column === "antifraud" || input.column === "antifraudStatus")) {
    const withoutSelf = { ...requestedFilters };
    delete withoutSelf[input.column];
    const masked = maskDisabledAntifraud(withoutSelf);
    if (masked.empty) return { items: [], truncated: false };
    if (q && !NO_ANTIFRAUD_LABEL.toLowerCase().includes(q.toLowerCase())) {
      return { items: [], truncated: false };
    }
    const signs = await resolveDeviceSigns(month, device);
    if (signs.length === 0) return { items: [], truncated: false };
    const phoneQ = input.phoneQ ?? "";
    const total = smgListNeedsSql(masked.filters, false)
      ? (
          await querySmgIdPage(
            queryRaw,
            {
              month,
              deviceSigns: signs,
              phoneQ,
              filters: masked.filters,
              setupSort: null,
              skip: 0,
              take: 1,
              storedAf: false,
            },
            labelsForTraceIds,
          )
        ).total
      : await prisma.smgCdrRecord.count({
          where: buildWhere(month, signs, masked.filters, phoneQ, { storedAf: false }),
        });
    if (total === 0) return { items: [], truncated: false };
    return { items: [{ value: NO_ANTIFRAUD_LABEL, count: total }], truncated: false };
  }
  if (mode.off && mode.empty) return { items: [], truncated: false };
  const signs = await resolveDeviceSigns(month, device);
  if (signs.length === 0) return { items: [], truncated: false };
  const filters = mode.filters;
  const touchAf =
    input.column === "antifraud" ||
    input.column === "antifraudStatus" ||
    filtersTouchAf(filters);
  const storedAf = touchAf ? await cdrLabelsReady(month, signs) : false;
  if (smgFacetNeedsSql(input.column, filters, storedAf)) {
    const items = await querySmgFacetValues(
      queryRaw,
      {
        column: input.column,
        month,
        deviceSigns: signs,
        phoneQ: input.phoneQ ?? "",
        filters,
        q,
        limit,
        storedAf,
      },
      labelsForTraceIds,
    );
    return { items: items.slice(0, limit), truncated: items.length > limit };
  }
  let where = buildWhere(month, signs, filters, input.phoneQ ?? "", {
    excludeColumn: input.column,
    storedAf,
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
