"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { EXPORT_XLSX_BUTTON_CLASS } from "@/components/export-xlsx-button-class";
import {
  ExportProgressBanner,
  type ExportBannerStatus,
} from "@/components/export-progress-banner";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format-count";
import type { ColumnFilters } from "@/components/column-filters/types";

const WARN_ROWS = 100_000;

type Job = {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  rowsWritten: number;
  totalRows: number | null;
  errorMessage: string | null;
  filename: string | null;
};

type Options = {
  endpoint: string;
  filters: ColumnFilters;
  phoneQ: string;
  totalRows: number | null;
  totalKnown: boolean;
};

function bannerStatus(status: Job["status"]): ExportBannerStatus {
  return status;
}

export function useFilteredExport({
  endpoint,
  filters,
  phoneQ,
  totalRows,
  totalKnown,
}: Options): { button: ReactNode; banner: ReactNode } {
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const downloadedFor = useRef<string | null>(null);
  const toastedFor = useRef<string | null>(null);
  const skipToast = useRef<string | null>(null);

  const poll = useCallback(
    async (id: string) => {
      const res = await fetch(`${endpoint}/${id}`, { cache: "no-store" });
      if (res.status === 404) {
        setJob((current) => (current?.id === id ? null : current));
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { job?: Job };
      if (data.job) setJob(data.job);
    },
    [endpoint],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`${endpoint}/active`, { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { job: Job | null };
      if (!data.job) return;
      if (data.job.status !== "running") {
        skipToast.current = `${data.job.id}:${data.job.status}`;
      }
      setJob(data.job);
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const timer = window.setInterval(() => {
      void poll(job.id);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [job, poll]);

  useEffect(() => {
    if (!job || job.status !== "completed") return;
    if (downloadedFor.current === job.id) return;
    downloadedFor.current = job.id;
    const link = document.createElement("a");
    link.href = `${endpoint}/${job.id}/download`;
    link.download = job.filename ?? "export.xlsx";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [endpoint, job]);

  useEffect(() => {
    if (!job || job.status === "running") return;
    const token = `${job.id}:${job.status}`;
    if (toastedFor.current === token || skipToast.current === token) {
      toastedFor.current = token;
      return;
    }
    toastedFor.current = token;
    if (job.status === "completed") toast.success("Экспорт XLSX завершён");
    if (job.status === "cancelled") toast.error("Экспорт отменён");
    if (job.status === "failed") {
      toast.error(job.errorMessage?.trim() || "Ошибка экспорта XLSX");
    }
  }, [job]);

  async function dismiss() {
    if (!job) return;
    const current = job;
    const res = await fetch(`${endpoint}/${current.id}/cancel`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(body?.error?.trim() || "Не удалось отменить выгрузку");
      return;
    }
    if (current.status === "running") {
      setJob({ ...current, status: "cancelled", errorMessage: null });
      return;
    }
    setJob(null);
  }

  async function start() {
    if (starting || job?.status === "running") return;
    if (!totalKnown) {
      const proceed = window.confirm(
        "Размер выборки неизвестен. Подготовка может занять некоторое время. Продолжить?",
      );
      if (!proceed) return;
    } else if (totalRows != null && totalRows > WARN_ROWS) {
      const proceed = window.confirm(
        `Будет выгружено ${formatCount(totalRows)} строк (полный набор по фильтрам). Подготовка может занять некоторое время. Продолжить?`,
      );
      if (!proceed) return;
    }
    setStarting(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters, phoneQ }),
      });
      const body = (await res.json().catch(() => null)) as {
        job?: Job;
        error?: string;
      } | null;
      if (!res.ok || !body?.job) {
        toast.error(body?.error?.trim() || "Не удалось начать выгрузку");
        return;
      }
      downloadedFor.current = null;
      toastedFor.current = null;
      setJob(body.job);
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || job?.status === "running";

  const button = (
    <Button
      type="button"
      className={EXPORT_XLSX_BUTTON_CLASS}
      disabled={busy}
      onClick={() => void start()}
    >
      {busy ? "Экспорт…" : "Экспорт XLSX"}
    </Button>
  );

  const banner = job ? (
    <ExportProgressBanner
      status={bannerStatus(job.status)}
      rowsWritten={job.rowsWritten}
      totalRows={job.totalRows}
      errorMessage={job.errorMessage}
      onCancel={job.status === "running" ? () => void dismiss() : undefined}
      onDismiss={job.status === "running" ? undefined : () => void dismiss()}
    />
  ) : null;

  return { button, banner };
}
