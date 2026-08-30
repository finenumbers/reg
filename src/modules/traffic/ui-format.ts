/**
 * Presentation helpers for traffic UI — pure, testable, no React.
 * Dates stay civil-clock from the CDR string; no timezone conversion.
 */

import { formatCount } from "@/lib/format-count";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import { csvTimeToDisplay } from "@/modules/enrich/dates";
import { formatCdrDayDisplay } from "@/modules/traffic/cdr-date-parts";
import {
  MISSING_BILLING_LABEL,
  MISSING_PSTN_LABEL,
} from "@/modules/enrich/types";

export { formatCdrDayDisplay };

export function formatCdrDateDisplay(raw: string): string {
  return csvTimeToDisplay(raw);
}

const DURATION_COLUMNS = new Set(["elapsed_time", "term_elapsed_time"]);

/** Softswitch `elapsed_time` is milliseconds; display whole seconds (ceil). */
export function formatDurationSeconds(raw: string): string {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return raw;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return raw;
  return formatCount(Math.ceil(n / 1000));
}

export function displayTrafficFacet(column: string, value: string): string {
  if (value === "" || value === EMPTY_FILTER_TOKEN) return "(пусто)";
  if (column === "cdr_date") return formatCdrDateDisplay(value);
  if (column === "cdr_day") return formatCdrDayDisplay(value);
  if (DURATION_COLUMNS.has(column)) return formatDurationSeconds(value);
  return value;
}

export function formatTrafficCell(column: string, raw: string): string {
  if (column === "cdr_date") return formatCdrDateDisplay(raw);
  if (column === "cdr_day") return formatCdrDayDisplay(raw);
  if (DURATION_COLUMNS.has(column)) return formatDurationSeconds(raw);
  return raw;
}

/** Text color for known enrich-miss phrases in table cells. */
export function trafficMissingLabelClass(value: string): string | undefined {
  if (value === MISSING_BILLING_LABEL) return "text-yellow-600";
  if (value === MISSING_PSTN_LABEL) return "text-red-600";
  return undefined;
}

export type TrafficBannerStatus = {
  lastError: string | null;
  pendingInboxCount: number;
  poisonedCount: number;
  runningCount: number;
};

/** Operator-facing inbox / partial-import notice. */
export function composeTrafficBanner(
  status: TrafficBannerStatus,
): string | null {
  const parts: string[] = [];
  if (status.pendingInboxCount >= 2) {
    const files = `${formatCount(status.pendingInboxCount)} необработанных файлов`;
    parts.push(
      status.runningCount > 0
        ? `В FTP-папке ${files}, импорт выполняется.`
        : `В FTP-папке ${files}, импорт запущен.`,
    );
  }
  if (status.lastError?.trim()) {
    parts.push(status.lastError.trim());
  } else if (status.poisonedCount > 0) {
    const n = status.poisonedCount;
    const files = n === 1 ? "1 файл" : `${formatCount(n)} файлов`;
    parts.push(
      `В FTP-папке ${files} с ошибкой импорта. Повторите импорт на странице «Сырые данные».`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
