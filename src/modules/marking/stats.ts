/**
 * Marking statistics for one calendar month.
 * One CDR aggregate is in flight per data key. A key that changes during the
 * read is returned to that caller and is not stored.
 */

import {
  CDR_VACUUM_BUSY_MESSAGE,
  isDatabaseVacuumActive,
} from "@/modules/storage/vacuum/gate";
import {
  currentUtcMonth,
  parseMonthKey,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";
import {
  cdrDataGeneration,
  listCachedMonthCounts,
} from "@/modules/traffic/cdr-month-stats";
import {
  requireBlockedNumberIndex,
  type BlockedNumberIndex,
} from "@/modules/phones/blocked-numbers";
import { loadOprsToneReport, type OprsToneLoad } from "@/modules/oprs/operator-tone-load";
import type { OprsOperatorToneMap } from "@/modules/oprs/operator-tone";
import { readRtuScreenGate, requestRtuScreenPublish } from "@/modules/rtu/screen-publish";
import { markingStatsSql } from "@/modules/marking/stats-sql";
import type { MarkingStatsRow } from "@/modules/marking/stats-sort";
import { withOprsTimeout } from "@/modules/oprs/timeout";

export type { MarkingStatsRow };

const TONE_ERROR = "Карта операторов ОПРС неполная, статистика не построена";
const BLOCKED_ERROR = "Каталог блокировок не прочитан, статистика не построена";
const COUNT_ERROR = "Некорректный подсчёт";
const STORE_KEY = "__reg_marking_stats__";

export class MarkingStatsError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MarkingStatsError";
    this.status = status;
  }
}

export type MarkingStatsSnapshot = {
  month: string;
  months: CdrMonth[];
  rows: MarkingStatsRow[];
  preparing: boolean;
  loadedAt: string | null;
  rowCount: number;
};

type QueryRow = {
  client: string | null;
  numbers: number | bigint | null;
  mts: number | bigint | null;
  megafon: number | bigint | null;
  beeline: number | bigint | null;
  t2: number | bigint | null;
  external: number | bigint | null;
  catalog_revision: number | bigint | null;
  loaded_at: Date | null;
};

type Slot = { key: string; snapshot: MarkingStatsSnapshot };

type Store = {
  slots: Map<string, Slot>;
  inflight: Map<string, Promise<MarkingStatsSnapshot>>;
};

export function statsCacheAccepted(input: {
  generationAtStart: number;
  generationAtEnd: number;
  revisionAtStart: number;
  revisionAtEnd: number;
}): boolean {
  return (
    input.generationAtStart === input.generationAtEnd &&
    input.revisionAtStart === input.revisionAtEnd
  );
}

export function markingStatsMonth(
  raw: string | null | undefined,
  now = new Date(),
): CdrMonth {
  if (raw == null || raw.trim() === "") return currentUtcMonth(now);
  const parsed = parseMonthKey(raw);
  if (!parsed) throw new MarkingStatsError(400, "Некорректный месяц");
  return parsed;
}

export function markingStatsRowFromCounts(input: {
  client: string;
  numbers: number;
  mts: number;
  megafon: number;
  beeline: number;
  t2: number;
  external: number;
}): MarkingStatsRow {
  const values = [
    input.numbers,
    input.mts,
    input.megafon,
    input.beeline,
    input.t2,
    input.external,
  ];
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new MarkingStatsError(500, COUNT_ERROR);
    }
  }
  const total = input.mts + input.megafon + input.beeline + input.t2 + input.external;
  if (!Number.isSafeInteger(total)) throw new MarkingStatsError(500, COUNT_ERROR);
  return { ...input, total };
}

export function toneToken(map: OprsOperatorToneMap): string {
  return Object.entries(map)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, tone]) => `${tone}:${name}`)
    .join("\n");
}

export function blockedToken(stamp: string, index: BlockedNumberIndex): string {
  return `${stamp}:${index.exact.size}:${index.pstn.size}`;
}

function cacheStore(): Store {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: Store };
  if (!g[STORE_KEY]) g[STORE_KEY] = { slots: new Map(), inflight: new Map() };
  return g[STORE_KEY];
}

function monthsWithoutCounts(months: readonly CdrMonth[]): CdrMonth[] {
  return months.map(({ year, month, key }) => ({ year, month, key }));
}

function asCount(value: unknown): number {
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new MarkingStatsError(500, COUNT_ERROR);
  return n;
}

function mapQuery(rows: QueryRow[]): {
  rows: MarkingStatsRow[];
  catalogRevision: number;
  loadedAt: string | null;
  rowCount: number;
} {
  const head = rows[0];
  const catalogRevision = asCount(head?.catalog_revision ?? 0);
  const loadedAt = head?.loaded_at ? new Date(head.loaded_at).toISOString() : null;
  const items: MarkingStatsRow[] = [];
  let rowCount = 0;
  for (const row of rows) {
    if (row.client == null || row.numbers == null) continue;
    const item = markingStatsRowFromCounts({
      client: row.client,
      numbers: asCount(row.numbers),
      mts: asCount(row.mts),
      megafon: asCount(row.megafon),
      beeline: asCount(row.beeline),
      t2: asCount(row.t2),
      external: asCount(row.external),
    });
    rowCount += item.numbers;
    if (!Number.isSafeInteger(rowCount)) throw new MarkingStatsError(500, COUNT_ERROR);
    items.push(item);
  }
  return { rows: items, catalogRevision, loadedAt, rowCount };
}

function preparingSnapshot(month: CdrMonth, months: CdrMonth[]): MarkingStatsSnapshot {
  return {
    month: month.key,
    months,
    rows: [],
    preparing: true,
    loadedAt: null,
    rowCount: 0,
  };
}

async function readSnapshot(
  month: CdrMonth,
  tone: OprsToneLoad,
  blocked: { stamp: string; index: BlockedNumberIndex },
  generationAtStart: number,
  revisionAtStart: number,
): Promise<MarkingStatsSnapshot> {
  const months = monthsWithoutCounts(await listCachedMonthCounts());
  const queried = await withOprsTimeout((tx) =>
    tx.$queryRaw<QueryRow[]>(
      markingStatsSql({
        year: month.year,
        month: month.month,
        tones: tone.map,
        blocked: blocked.index,
      }),
    ),
  );
  const mapped = mapQuery(queried);
  const snapshot: MarkingStatsSnapshot = {
    month: month.key,
    months: months.some((item) => item.key === month.key) ? months : [month, ...months],
    rows: mapped.rows,
    preparing: false,
    loadedAt: mapped.loadedAt,
    rowCount: mapped.rowCount,
  };
  const generationAtEnd = cdrDataGeneration();
  const after = isDatabaseVacuumActive() ? null : await readRtuScreenGate();
  const accepted =
    after != null &&
    mapped.catalogRevision === revisionAtStart &&
    statsCacheAccepted({
      generationAtStart,
      generationAtEnd,
      revisionAtStart,
      revisionAtEnd: after.catalogRevision,
    });
  if (accepted) {
    const key = statsKey(month.key, generationAtStart, revisionAtStart, tone, blocked);
    cacheStore().slots.set(month.key, { key, snapshot });
  }
  return snapshot;
}

function statsKey(
  month: string,
  generation: number,
  revision: number,
  tone: OprsToneLoad,
  blocked: { stamp: string; index: BlockedNumberIndex },
): string {
  return [
    month,
    String(generation),
    String(revision),
    tone.labelUnpainted ? "1" : "0",
    toneToken(tone.map),
    blockedToken(blocked.stamp, blocked.index),
  ].join("|");
}

export async function listMarkingStats(
  monthRaw: string | null | undefined,
  now = new Date(),
): Promise<MarkingStatsSnapshot> {
  if (isDatabaseVacuumActive()) {
    throw new MarkingStatsError(503, CDR_VACUUM_BUSY_MESSAGE);
  }
  const month = markingStatsMonth(monthRaw, now);
  const gate = await readRtuScreenGate();
  if (!gate?.published || gate.needsPublish) {
    void requestRtuScreenPublish();
  }
  const months = monthsWithoutCounts(await listCachedMonthCounts());
  if (!gate?.published) return preparingSnapshot(month, months);

  const tone = await loadOprsToneReport(now.getTime(), { wait: true });
  if (!tone.labelUnpainted) throw new MarkingStatsError(503, TONE_ERROR);

  let blocked: { stamp: string; index: BlockedNumberIndex };
  try {
    blocked = await requireBlockedNumberIndex();
  } catch {
    throw new MarkingStatsError(503, BLOCKED_ERROR);
  }

  const generation = cdrDataGeneration();
  const key = statsKey(month.key, generation, gate.catalogRevision, tone, blocked);
  const store = cacheStore();
  const slot = store.slots.get(month.key);
  if (slot?.key === key) return slot.snapshot;
  const inflight = store.inflight.get(key);
  if (inflight) return inflight;

  const promise = readSnapshot(
    month,
    tone,
    blocked,
    generation,
    gate.catalogRevision,
  ).finally(() => {
    if (store.inflight.get(key) === promise) store.inflight.delete(key);
  });
  store.inflight.set(key, promise);
  return promise;
}

export async function loadMarkingStatsPageInitial(
  now = new Date(),
): Promise<{ initial: MarkingStatsSnapshot; initialError: string | null }> {
  try {
    return { initial: await listMarkingStats(null, now), initialError: null };
  } catch (error) {
    const month = currentUtcMonth(now);
    const message =
      error instanceof MarkingStatsError
        ? error.message
        : "Не удалось загрузить статистику маркировки";
    return {
      initial: {
        month: month.key,
        months: [month],
        rows: [],
        preparing: false,
        loadedAt: null,
        rowCount: 0,
      },
      initialError: message,
    };
  }
}

export function isMarkingStatsStatementTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return (
    code === "57014" || message.includes("57014") || /statement timeout/i.test(message)
  );
}
