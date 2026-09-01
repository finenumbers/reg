/**
 * Presentation helpers for Jobs UI — pure, testable, no React.
 */

import { formatCount } from "@/lib/format-count";
import { formatDisplayTimestamp } from "@/lib/format-display-time";
import type { JobRunListItem } from "@/modules/jobs/query";
import { parseMonthKey } from "@/modules/traffic/cdr-month";
import { formatMonthNominative } from "@/modules/traffic/month-labels";

const JOB_ACTION_LABELS: Record<string, string> = {
  "regs.poll": "Опрос регистраций",
  "phones.sync": "Синхронизация телефонов",
  "groups.sync": "Загрузка групп",
  "cdr.import": "Импорт CDR",
  "voipmonitor.match": "VoIPmonitor",
  "cdr.sides.refresh": "Описания сторон",
  "cdr.purge.month": "Удаление месяца",
};

const META_FILES_CAP = 8;

export type JobStatusFilter = "" | "running" | "success" | "failed";

export function formatJobTimestamp(
  value: string | null | undefined,
  timeZone: string,
): string {
  return formatDisplayTimestamp(value, timeZone);
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  return String(Math.ceil(ms / 1000));
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

export function formatJobAction(actionCode: string): string {
  return JOB_ACTION_LABELS[actionCode] ?? actionCode;
}

export function formatJobActionTitle(actionCode: string): string {
  const label = JOB_ACTION_LABELS[actionCode];
  return label ? `${label} (${actionCode})` : actionCode;
}

export type JobMetaDetail = { label: string; value: string };

function jobMeta(job: JobRunListItem): Record<string, unknown> | null {
  const meta = job.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return meta;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function formatPurgeMonth(raw: unknown): string | null {
  const key = stringValue(raw);
  if (!key) return null;
  const parsed = parseMonthKey(key);
  if (!parsed) return key;
  return formatMonthNominative(parsed.year, parsed.month);
}

function joinParts(parts: string[]): string {
  return parts.length > 0 ? parts.join(" · ") : "Готово";
}

function summarizeRegsPoll(job: JobRunListItem): string {
  const meta = jobMeta(job);
  const parts: string[] = [];
  if (job.phonesParsed != null) {
    parts.push(`${formatCount(job.phonesParsed)} номеров`);
  }
  if (job.changesCount != null) {
    if (job.changesCount > 0) {
      parts.push(`${formatCount(job.changesCount)} изменений`);
    } else if (job.phonesParsed != null && job.phonesParsed > 0) {
      parts.push("без изменений");
    }
  }
  const removed = finiteNumber(meta?.removed);
  if (removed != null && removed > 0) {
    parts.push(`${formatCount(removed)} снято`);
  }
  const duplicates = finiteNumber(meta?.duplicatePhones);
  if (duplicates != null && duplicates > 0) {
    parts.push(`${formatCount(duplicates)} дублей`);
  }
  if (job.linesBad != null && job.linesBad > 0) {
    parts.push(`${formatCount(job.linesBad)} плохих строк`);
  }
  return joinParts(parts);
}

function summarizePhonesSync(job: JobRunListItem): string {
  const meta = jobMeta(job);
  const parts: string[] = [];
  if (job.phonesParsed != null) {
    parts.push(`${formatCount(job.phonesParsed)} номеров`);
  }
  const endpoints = finiteNumber(meta?.endpointCount);
  const gateways = finiteNumber(meta?.gatewayCount);
  if (endpoints != null) parts.push(`${formatCount(endpoints)} EP`);
  if (gateways != null) parts.push(`${formatCount(gateways)} шлюзов`);
  return joinParts(parts);
}

function summarizeGroupsSync(job: JobRunListItem): string {
  if (job.phonesParsed != null) {
    return `${formatCount(job.phonesParsed)} групп`;
  }
  return "Готово";
}

function summarizeCdrImport(job: JobRunListItem): string {
  const meta = jobMeta(job);
  const files = stringList(meta?.files);
  const fileCount = finiteNumber(meta?.fileCount) ?? (files.length > 0 ? files.length : null);
  const backfilled = finiteNumber(meta?.backfilled) ?? 0;
  const remaining = finiteNumber(meta?.backfillRemaining) ?? 0;
  const hasFiles = (fileCount != null && fileCount > 0) || files.length > 0;
  const backfillOnly = !hasFiles && (backfilled > 0 || remaining > 0);

  if (backfillOnly) {
    const parts: string[] = [];
    if (backfilled > 0) parts.push(`дообогащено ${formatCount(backfilled)}`);
    if (remaining > 0) parts.push(`осталось обогатить ${formatCount(remaining)}`);
    return joinParts(parts);
  }

  const parts: string[] = [];
  if (job.phonesParsed != null) {
    parts.push(`${formatCount(job.phonesParsed)} записей`);
  }
  if (fileCount != null && fileCount > 0) {
    parts.push(`${formatCount(fileCount)} файлов`);
  }
  if (job.linesBad != null && job.linesBad > 0) {
    parts.push(`${formatCount(job.linesBad)} битых строк`);
  }
  if (job.changesCount != null && job.changesCount > 0) {
    parts.push(`${formatCount(job.changesCount)} уже в базе`);
  }
  if (remaining > 0) {
    parts.push(`осталось обогатить ${formatCount(remaining)}`);
  }
  return joinParts(parts);
}

function isEmptyVoipmonitorQueue(meta: Record<string, unknown> | null): boolean {
  if (!meta) return false;
  const remaining = finiteNumber(meta.remainingHours);
  if (remaining !== 0) return false;
  return Array.isArray(meta.hours) && meta.hours.length === 0;
}

function summarizeVoipmonitor(job: JobRunListItem): string {
  const meta = jobMeta(job);
  if (meta?.skipped === true) {
    const reason = stringValue(meta.reason);
    if (reason === "disabled") return "Пропущено: выключено в Настройках";
    if (reason === "missing_credentials") return "Пропущено: нет учётных данных";
    return "Пропущено";
  }
  if (isEmptyVoipmonitorQueue(meta)) {
    return "Нечего сопоставлять";
  }
  const parts: string[] = [];
  if (job.phonesParsed != null) {
    parts.push(`${formatCount(job.phonesParsed)} сопоставлено`);
  }
  if (job.changesCount != null) {
    parts.push(`${formatCount(job.changesCount)} записано`);
  }
  if (job.errorMessage?.trim()) {
    parts.push("есть ошибки по часам");
  }
  return joinParts(parts);
}

function summarizeSidesRefresh(job: JobRunListItem): string {
  const meta = jobMeta(job);
  const parts: string[] = [];
  if (job.changesCount != null) {
    parts.push(`${formatCount(job.changesCount)} строк обновлено`);
  }
  if (job.phonesParsed != null) {
    parts.push(`${formatCount(job.phonesParsed)} номеров в diff`);
  }
  if (meta?.replay === true) {
    parts.push("повторный прогон");
  }
  return joinParts(parts);
}

function summarizePurge(job: JobRunListItem): string {
  const message = job.errorMessage?.trim();
  if (message) return message;
  const meta = jobMeta(job);
  const deleted =
    job.phonesParsed ??
    finiteNumber(meta?.deletedCount) ??
    finiteNumber(meta?.targetCount);
  const parts: string[] = [];
  if (deleted != null) {
    parts.push(`Удалено ${formatCount(deleted)}`);
  }
  const month = formatPurgeMonth(meta?.month);
  if (month) parts.push(month);
  return joinParts(parts);
}

function summarizeUnknownSuccess(job: JobRunListItem): string {
  const parts: string[] = [];
  if (job.phonesParsed != null) {
    parts.push(formatCount(job.phonesParsed));
  }
  if (job.linesBad != null && job.linesBad > 0) {
    parts.push(`${formatCount(job.linesBad)} плохих строк`);
  }
  if (job.changesCount != null && job.changesCount > 0) {
    parts.push(`${formatCount(job.changesCount)} изменений`);
  }
  return joinParts(parts);
}

/** Concise operator-facing result line from counters + error. */
export function summarizeJobResult(job: JobRunListItem): string {
  if (job.status === "running") {
    return "Выполняется…";
  }
  if (job.status === "failed") {
    const err = job.errorMessage?.trim();
    if (err) return err;
    if (job.actionCode === "cdr.import" && (job.linesBad ?? 0) > 0) {
      return `Частичная загрузка CDR: ${formatCount(job.linesBad ?? 0)} битых строк`;
    }
    return "Ошибка (без деталей)";
  }

  switch (job.actionCode) {
    case "regs.poll":
      return summarizeRegsPoll(job);
    case "phones.sync":
      return summarizePhonesSync(job);
    case "groups.sync":
      return summarizeGroupsSync(job);
    case "cdr.import":
      return summarizeCdrImport(job);
    case "voipmonitor.match":
      return summarizeVoipmonitor(job);
    case "cdr.sides.refresh":
      return summarizeSidesRefresh(job);
    case "cdr.purge.month":
      return summarizePurge(job);
    default:
      return summarizeUnknownSuccess(job);
  }
}

function pushCountDetail(
  details: JobMetaDetail[],
  label: string,
  value: unknown,
  skipZero = false,
): void {
  const n = finiteNumber(value);
  if (n == null) return;
  if (skipZero && n <= 0) return;
  details.push({ label, value: formatCount(n) });
}

function formatHourDetail(
  hour: Record<string, unknown>,
  timeZone: string,
): string | null {
  const lane = stringValue(hour.lane) ?? "час";
  const when = stringValue(hour.hour);
  const stamped = when ? formatJobTimestamp(when, timeZone) : null;
  const matched = finiteNumber(hour.matched);
  const error = stringValue(hour.error);
  const bits = [lane];
  if (stamped) bits.push(stamped);
  if (matched != null) bits.push(`${formatCount(matched)} сопоставлено`);
  if (error) bits.push(error);
  return bits.length > 1 || error ? bits.join(" · ") : null;
}

/** Whitelisted operator-facing pairs from sanitized job meta. */
export function formatJobMetaDetails(
  job: JobRunListItem,
  timeZone: string,
): JobMetaDetail[] {
  const meta = jobMeta(job);
  if (!meta) return [];
  const details: JobMetaDetail[] = [];

  const month = formatPurgeMonth(meta.month);
  if (month) details.push({ label: "Месяц", value: month });

  const files = stringList(meta.files);
  if (files.length > 0) {
    const shown = files.slice(0, META_FILES_CAP);
    const extra = files.length - shown.length;
    details.push({
      label: "Файлы",
      value:
        extra > 0
          ? `${shown.join(", ")} · ещё ${formatCount(extra)}`
          : shown.join(", "),
    });
  } else {
    pushCountDetail(details, "Файлы", meta.fileCount, true);
  }

  pushCountDetail(details, "EP", meta.endpointCount);
  pushCountDetail(details, "Шлюзы", meta.gatewayCount);
  pushCountDetail(details, "Снято", meta.removed, true);
  pushCountDetail(details, "Дубли", meta.duplicatePhones, true);
  pushCountDetail(details, "Дообогащено", meta.backfilled, true);
  pushCountDetail(details, "Осталось обогатить", meta.backfillRemaining, true);

  const enrich =
    meta.enrich && typeof meta.enrich === "object" && !Array.isArray(meta.enrich)
      ? (meta.enrich as Record<string, unknown>)
      : null;
  if (enrich) {
    const pstnCache = finiteNumber(enrich.pstnCacheHits) ?? 0;
    const pstnLive = finiteNumber(enrich.pstnLiveLookups) ?? 0;
    const geoCache = finiteNumber(enrich.geoCacheHits) ?? 0;
    const geoLive = finiteNumber(enrich.geoLiveLookups) ?? 0;
    if (pstnCache + pstnLive + geoCache + geoLive > 0) {
      details.push({
        label: "Обогащение",
        value: `PSTN cache ${formatCount(pstnCache)} · live ${formatCount(pstnLive)}; GeoIP cache ${formatCount(geoCache)} · live ${formatCount(geoLive)}`,
      });
    }
  }

  if (meta.skipped === true) {
    const reason = stringValue(meta.reason);
    details.push({
      label: "Пропуск",
      value:
        reason === "disabled"
          ? "выключено в Настройках"
          : reason === "missing_credentials"
            ? "нет учётных данных"
            : (reason ?? "да"),
    });
  }

  if (meta.replay === true) {
    details.push({ label: "Прогон", value: "повторный" });
  }

  if (Array.isArray(meta.hours)) {
    for (const raw of meta.hours) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const line = formatHourDetail(raw as Record<string, unknown>, timeZone);
      if (line) details.push({ label: "Час", value: line });
    }
  }

  return details;
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
