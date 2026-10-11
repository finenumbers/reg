import { formatCount } from "@/lib/format-count";
import { parseMonthKey } from "@/modules/traffic/cdr-month";

export const PURGE_STAGE_ORDER = ["calls", "jobs", "audit"] as const;

export type PurgeStageId = (typeof PURGE_STAGE_ORDER)[number];

export type PurgeStageCounts = {
  done: number;
  total: number;
};

export type PurgeStagesMeta = Record<PurgeStageId, PurgeStageCounts>;

export const PURGE_INTERRUPT_NOTE =
  "При перезапуске сервера текущий запрос обрывается. Если звонки месяца уже удалены, задачи и аудит этого месяца продолжаются после старта.";

const STAGE_LABEL: Record<PurgeStageId, string> = {
  calls: "Звонки",
  jobs: "Задачи",
  audit: "Аудит",
};

export type PurgeStageView = {
  id: PurgeStageId;
  label: string;
  done: number;
  total: number;
  state: "done" | "active" | "pending";
};

export type PurgeProgress =
  | {
      month: string;
      mode: "stages";
      stages: PurgeStageView[];
    }
  | {
      month: string;
      mode: "legacy";
      deleted: number;
      target: number;
    };

function objectMeta(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return meta as Record<string, unknown>;
}

function finiteCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  return null;
}

function readPhase(value: unknown): PurgeStageId | null {
  return PURGE_STAGE_ORDER.find((id) => id === value) ?? null;
}

function readStages(value: unknown): PurgeStagesMeta | null {
  const record = objectMeta(value);
  if (!record) return null;
  const stages = {} as PurgeStagesMeta;
  for (const id of PURGE_STAGE_ORDER) {
    const raw = objectMeta(record[id]);
    const done = finiteCount(raw?.done);
    const total = finiteCount(raw?.total);
    if (done == null || total == null) return null;
    stages[id] = { done, total };
  }
  return stages;
}

export function purgeStageViews(
  stages: PurgeStagesMeta,
  phase: PurgeStageId,
): PurgeStageView[] {
  const phaseIndex = PURGE_STAGE_ORDER.indexOf(phase);
  return PURGE_STAGE_ORDER.map((id, index) => {
    const counts = stages[id];
    const state =
      counts.total === 0 || index < phaseIndex
        ? "done"
        : index === phaseIndex
          ? "active"
          : "pending";
    return {
      id,
      label: STAGE_LABEL[id],
      done: counts.done,
      total: counts.total,
      state,
    };
  });
}

/** Live banner model. Stages win; an older running row stays one calls line. */
export function purgeProgressFromJob(input: {
  phonesParsed: number | null;
  meta: unknown;
}): PurgeProgress | null {
  const meta = objectMeta(input.meta);
  const month =
    typeof meta?.month === "string" ? (parseMonthKey(meta.month)?.key ?? null) : null;
  if (!month) return null;

  const stages = readStages(meta?.stages);
  const phase = readPhase(meta?.phase);
  if (stages && phase) {
    return { month, mode: "stages", stages: purgeStageViews(stages, phase) };
  }

  return {
    month,
    mode: "legacy",
    deleted: finiteCount(input.phonesParsed) ?? finiteCount(meta?.deletedCount) ?? 0,
    target: finiteCount(meta?.targetCount) ?? 0,
  };
}

export function purgeStageLine(stage: PurgeStageView): string {
  if (stage.state === "pending") {
    return `${stage.label} — ожидает, ${formatCount(stage.total)}`;
  }
  if (stage.state === "active") {
    return `${stage.label} — ${formatCount(stage.done)} / ${formatCount(stage.total)}`;
  }
  if (stage.done !== stage.total) {
    return `${stage.label} — готово, ${formatCount(stage.done)} / ${formatCount(stage.total)}`;
  }
  return `${stage.label} — готово, ${formatCount(stage.done)}`;
}
