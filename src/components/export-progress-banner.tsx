"use client";

import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format-count";
import { cn } from "@/lib/utils";

export type ExportBannerStatus = "running" | "completed" | "failed" | "cancelled";

type Props = {
  status: ExportBannerStatus;
  rowsWritten: number;
  totalRows: number | null;
  errorMessage?: string | null;
  onCancel?: () => void;
  onDownload?: () => void;
  onDismiss?: () => void;
};

/**
 * Progress for the three catalog XLSX builds. Same messages as the PSTN
 * range export. Other REG exports do not use this banner.
 */
export function ExportProgressBanner({
  status,
  rowsWritten,
  totalRows,
  errorMessage,
  onCancel,
  onDownload,
  onDismiss,
}: Props) {
  const isActive = status === "running";
  const isDone = status === "completed";
  const isFailed = status === "failed" || status === "cancelled";
  const knownTotal = totalRows != null && totalRows > 0;
  const pct = knownTotal ? Math.min(100, Math.round((rowsWritten / totalRows) * 100)) : 0;

  return (
    <div
      className={cn(
        "shrink-0 rounded-md border px-4 py-3 text-sm",
        isActive && "border-blue-200 bg-blue-50 text-blue-950",
        isDone && "border-green-200 bg-green-50 text-green-950",
        isFailed && "border-red-200 bg-red-50 text-red-950",
      )}
      role="status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isActive ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          <span className="font-medium">
            {isActive ? "Формируем XLSX…" : null}
            {isDone ? "Экспорт XLSX готов" : null}
            {status === "failed" ? "Ошибка экспорта XLSX" : null}
            {status === "cancelled" ? "Экспорт отменён" : null}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isActive && onCancel ? (
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Отменить
            </Button>
          ) : null}
          {isDone && onDownload ? (
            <Button type="button" variant="outline" size="sm" onClick={onDownload}>
              Скачать
            </Button>
          ) : null}
          {(isDone || isFailed) && onDismiss ? (
            <button
              type="button"
              className="rounded p-1 hover:bg-black/5"
              onClick={onDismiss}
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      {knownTotal ? (
        <p className="mt-1 tabular-nums">
          {formatCount(rowsWritten)} / {formatCount(totalRows)} строк ({pct}%)
        </p>
      ) : isActive ? (
        <p className="mt-1 tabular-nums">Записано {formatCount(rowsWritten)} строк</p>
      ) : null}
      {status === "failed" && errorMessage?.trim() ? (
        <p className="mt-1">{errorMessage.trim()}</p>
      ) : null}
      {isActive && knownTotal ? (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
