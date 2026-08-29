export const MONTH_EXPORT_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;
export const MONTH_EXPORT_PAGE_SIZE = 2000;
export const MONTH_EXPORT_UPDATE_BATCH = 300;
export const MONTH_EXPORT_PROGRESS_MS = 500;

export type MonthExportStageId =
  | "period"
  | "read"
  | "fill"
  | "traffic"
  | "detail"
  | "download";

export type MonthExportStageStatus = "pending" | "running" | "done" | "error";

export type MonthExportStageView = {
  id: MonthExportStageId;
  label: string;
  status: MonthExportStageStatus;
  current?: number;
  total?: number;
  detail?: string;
};

export const INITIAL_MONTH_EXPORT_STAGES: MonthExportStageView[] = [
  { id: "period", label: "Определение периода", status: "pending" },
  { id: "read", label: "Чтение звонков", status: "pending" },
  { id: "fill", label: "PSTN и GeoIP", status: "pending" },
  { id: "traffic", label: "Лист месяца", status: "pending" },
  { id: "detail", label: "Лист «Детализация»", status: "pending" },
  { id: "download", label: "Скачивание", status: "pending" },
];

export function monthExportStages(includeDetail: boolean): MonthExportStageView[] {
  const stages = includeDetail
    ? INITIAL_MONTH_EXPORT_STAGES
    : INITIAL_MONTH_EXPORT_STAGES.filter((stage) => stage.id !== "detail");
  return stages.map((stage) => ({ ...stage }));
}

export type MonthExportJobStatus = "queued" | "running" | "completed" | "failed";

export type MonthExportJobView = {
  id: string;
  status: MonthExportJobStatus;
  month: string;
  includeDetail: boolean;
  title: string;
  trafficSheetName: string;
  filename: string;
  stages: MonthExportStageView[];
  errorMessage: string | null;
  downloadUrl: string | null;
};

export function isActiveMonthExport(
  job: Pick<MonthExportJobView, "status"> | null,
): boolean {
  return job != null && (job.status === "queued" || job.status === "running");
}

export function isFinishedMonthExport(
  job: Pick<MonthExportJobView, "status"> | null,
): boolean {
  return job != null && (job.status === "completed" || job.status === "failed");
}

export function failOpenMonthExportStages(
  stages: MonthExportStageView[],
  detail: string,
): MonthExportStageView[] {
  return stages.map((stage) =>
    stage.status === "done" || stage.status === "error"
      ? stage
      : { ...stage, status: "error", detail },
  );
}

export function elapsedMsToSeconds(raw: string): number {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.ceil(n / 1000);
}
