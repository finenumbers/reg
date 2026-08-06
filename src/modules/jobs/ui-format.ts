/**
 * Presentation helpers for Jobs UI — pure, testable, no React.
 */

import type { JobRunListItem } from "@/modules/jobs/query";

export type JobStatusFilter = "" | "running" | "success" | "failed";

export function formatJobTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} мс`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} с`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes} мин ${rem} с`;
}

export function jobStatusBadgeVariant(
  status: JobRunListItem["status"],
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "success":
      return "default";
    case "failed":
      return "destructive";
    case "running":
      return "outline";
    default:
      return "secondary";
  }
}

export function formatJobStatus(status: JobRunListItem["status"]): string {
  switch (status) {
    case "success":
      return "успех";
    case "failed":
      return "ошибка";
    case "running":
      return "выполняется";
    default:
      return status;
  }
}

export function formatJobTrigger(trigger: JobRunListItem["trigger"]): string {
  switch (trigger) {
    case "manual":
      return "Вручную";
    case "schedule":
      return "По расписанию";
    case "test":
      return "Тест";
    default:
      return trigger;
  }
}

/** Concise operator-facing result line from counters + error. */
export function summarizeJobResult(job: JobRunListItem): string {
  if (job.status === "running") {
    return "Выполняется…";
  }
  if (job.status === "failed") {
    return job.errorMessage?.trim() || "Ошибка (без деталей)";
  }

  const parts: string[] = [];
  if (job.phonesParsed != null) parts.push(`${job.phonesParsed} номеров`);
  if (job.linesBad != null && job.linesBad > 0) {
    parts.push(`${job.linesBad} плохих строк`);
  }
  if (job.changesCount != null) parts.push(`${job.changesCount} изменений`);
  if (job.exitCode != null) parts.push(`код ${job.exitCode}`);
  if (job.hasArtifact) parts.push("есть артефакт");
  return parts.length > 0 ? parts.join(" · ") : "Успех";
}

export type JobsListQuery = {
  status?: JobStatusFilter;
  actionCode?: string;
  page?: number;
  pageSize?: number;
};

export function buildJobsListUrl(query: JobsListQuery = {}): string {
  const params = new URLSearchParams();
  if (
    query.status === "running" ||
    query.status === "success" ||
    query.status === "failed"
  ) {
    params.set("status", query.status);
  }
  const action = query.actionCode?.trim();
  if (action) params.set("actionCode", action);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.pageSize && query.pageSize !== 100) {
    params.set("pageSize", String(query.pageSize));
  }
  const qs = params.toString();
  return qs ? `/api/jobs?${qs}` : "/api/jobs";
}
