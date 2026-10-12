import { formatCount } from "@/lib/format-count";
import {
  VACUUM_TABLE_LABEL,
  VACUUM_TABLE_ORDER,
  type VacuumTableId,
} from "@/modules/storage/vacuum/sql";

/** Same text as jobs/reclaim-orphans ORPHAN_RECLAIM_MESSAGE. Kept here so the client bundle does not import Prisma. */
export const VACUUM_RESTART_MARK = "interrupted: process restarted";

export const VACUUM_INTERRUPT_NOTE =
  "При перезапуске текущая таблица не меняется. Уже сжатые таблицы остаются сжатыми. Сжатие само не продолжается.";

const PHASE_LABEL: Record<string, string> = {
  initializing: "подготовка",
  "seq scanning heap": "просмотр кучи",
  "index scanning heap": "просмотр кучи по индексу",
  "sorting tuples": "сортировка",
  "writing new heap": "запись новой кучи",
  "swapping relation files": "подмена файла",
  "rebuilding index": "перестроение индекса",
  "performing final cleanup": "завершение",
};

export type VacuumTableState = "pending" | "active" | "done" | "failed";

export type VacuumClusterRow = {
  relname: string;
  phase: string | null;
  scanned: number | null;
  written: number | null;
};

export type VacuumStageView = {
  id: VacuumTableId;
  label: string;
  state: VacuumTableState;
  phaseLabel: string | null;
  scanned: number | null;
  written: number | null;
  error: string | null;
};

export type VacuumProgressView = {
  stages: VacuumStageView[];
  note: string;
};

export type VacuumFailureView = {
  stages: VacuumStageView[];
  message: string;
};

function objectMeta(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return meta as Record<string, unknown>;
}

function readTableId(value: unknown): VacuumTableId | null {
  return VACUUM_TABLE_ORDER.find((id) => id === value) ?? null;
}

function readTableState(value: unknown): VacuumTableState | null {
  if (
    value === "pending" ||
    value === "active" ||
    value === "done" ||
    value === "failed"
  ) {
    return value;
  }
  return null;
}

export function vacuumPhaseLabel(phase: string | null | undefined): string | null {
  if (!phase) return null;
  return PHASE_LABEL[phase] ?? phase;
}

export function vacuumStageMeta(
  active: VacuumTableId,
  failed: VacuumTableId | null = null,
): { phase: VacuumTableId; tables: Record<VacuumTableId, VacuumTableState> } {
  const activeIndex = VACUUM_TABLE_ORDER.indexOf(active);
  const tables = {} as Record<VacuumTableId, VacuumTableState>;
  for (const id of VACUUM_TABLE_ORDER) {
    const index = VACUUM_TABLE_ORDER.indexOf(id);
    if (id === failed) tables[id] = "failed";
    else if (index < activeIndex) tables[id] = "done";
    else if (id === active) tables[id] = "active";
    else tables[id] = "pending";
  }
  return { phase: active, tables };
}

export function vacuumDoneMeta(): {
  phase: VacuumTableId;
  tables: Record<VacuumTableId, VacuumTableState>;
} {
  const tables = {} as Record<VacuumTableId, VacuumTableState>;
  for (const id of VACUUM_TABLE_ORDER) tables[id] = "done";
  return { phase: "cdr_records", tables };
}

function finiteCount(value: unknown): number | null {
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
  return null;
}

export function vacuumClusterFromRow(row: {
  relname?: unknown;
  phase?: unknown;
  scanned?: unknown;
  written?: unknown;
} | null): VacuumClusterRow | null {
  if (!row || typeof row.relname !== "string") return null;
  return {
    relname: row.relname,
    phase: typeof row.phase === "string" ? row.phase : null,
    scanned: finiteCount(row.scanned),
    written: finiteCount(row.written),
  };
}

export function vacuumFailureMessage(
  errorMessage: string | null | undefined,
  activeLabel: string | null,
): string {
  const raw = errorMessage?.trim() || "Сжатие прервано";
  if (raw === VACUUM_RESTART_MARK) {
    const table = activeLabel ? ` Таблица «${activeLabel}» не изменилась.` : "";
    return `Сжатие прервано перезапуском.${table} Уже сжатые таблицы остались сжатыми. Запустите сжатие снова.`;
  }
  return raw;
}

export function vacuumViews(input: {
  meta: unknown;
  cluster?: VacuumClusterRow | null;
  errorMessage?: string | null;
  failed?: boolean;
}): { stages: VacuumStageView[]; message: string | null } {
  const meta = objectMeta(input.meta);
  const phase = readTableId(meta?.phase);
  const rawTables = objectMeta(meta?.tables);
  const failed = input.failed === true;
  const activeLabel = phase ? VACUUM_TABLE_LABEL[phase] : null;
  const message = failed
    ? vacuumFailureMessage(input.errorMessage, activeLabel)
    : null;
  const cluster = input.cluster ?? null;

  const stages = VACUUM_TABLE_ORDER.map((id) => {
    const stored = readTableState(rawTables?.[id]);
    const state: VacuumTableState = stored ?? (phase === id ? "active" : "pending");
    const showCluster = state === "active" && cluster?.relname === id;
    return {
      id,
      label: VACUUM_TABLE_LABEL[id],
      state,
      phaseLabel: showCluster ? vacuumPhaseLabel(cluster?.phase) : null,
      scanned: showCluster ? (cluster?.scanned ?? null) : null,
      written: showCluster ? (cluster?.written ?? null) : null,
      error: state === "failed" ? message : null,
    };
  });

  return { stages, message };
}

export function vacuumStageLine(stage: VacuumStageView): string {
  if (stage.state === "pending") return `${stage.label} — ожидает`;
  if (stage.state === "failed") {
    return stage.error
      ? `${stage.label} — ошибка: ${stage.error}`
      : `${stage.label} — ошибка`;
  }
  if (stage.state === "active") {
    const phase = stage.phaseLabel ? `, ${stage.phaseLabel}` : "";
    const counts =
      stage.scanned != null
        ? ` — просмотрено ${formatCount(stage.scanned)}, записано ${formatCount(stage.written ?? 0)}`
        : "";
    return `${stage.label} — идёт${phase}${counts}`;
  }
  return `${stage.label} — готово`;
}
