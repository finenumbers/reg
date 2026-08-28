"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format-count";
import { utcExportMonth, type MonthPeriod } from "@/lib/month-window";
import { monthExportButtonLabel } from "@/modules/traffic/month-labels";
import {
  isActiveMonthExport,
  isFinishedMonthExport,
  type MonthExportJobView,
  type MonthExportStageView,
} from "@/modules/traffic/month-export-types";

function stageBadge(status: MonthExportStageView["status"]) {
  if (status === "done") return <Badge variant="secondary">готово</Badge>;
  if (status === "running") return <Badge>идёт</Badge>;
  if (status === "error") return <Badge variant="destructive">ошибка</Badge>;
  return <Badge variant="outline">ожидание</Badge>;
}

function dismissFinishedJob(job: MonthExportJobView | null) {
  if (!isFinishedMonthExport(job) || !job) return;
  void fetch(`/api/traffic/export/${job.id}`, { method: "DELETE", keepalive: true });
}

export function MonthExportButtons() {
  const now = new Date();
  const previous = utcExportMonth("previous", now);
  const current = utcExportMonth("current", now);
  const previousLabel = monthExportButtonLabel(
    "previous",
    previous.year,
    previous.month,
  );
  const currentLabel = monthExportButtonLabel(
    "current",
    current.year,
    current.month,
  );

  const jobRef = useRef<MonthExportJobView | null>(null);
  const downloadedFor = useRef<string | null>(null);
  const [job, setJob] = useState<MonthExportJobView | null>(null);
  const [starting, setStarting] = useState<MonthPeriod | null>(null);
  jobRef.current = job;

  const pollJob = useCallback(async (id: string) => {
    const res = await fetch(`/api/traffic/export/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { job: MonthExportJobView };
    setJob(data.job);
    return data.job;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/traffic/export/active", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { job: MonthExportJobView | null };
      if (data.job && isActiveMonthExport(data.job)) {
        setJob(data.job);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!job || !isActiveMonthExport(job)) return;
    const timer = window.setInterval(() => {
      void pollJob(job.id);
    }, 800);
    return () => window.clearInterval(timer);
  }, [job, pollJob]);

  useEffect(() => {
    if (!job || job.status !== "completed" || !job.downloadUrl) return;
    if (downloadedFor.current === job.id) return;
    downloadedFor.current = job.id;
    const a = document.createElement("a");
    a.href = job.downloadUrl;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [job]);

  useEffect(() => {
    return () => {
      dismissFinishedJob(jobRef.current);
    };
  }, []);

  async function start(period: MonthPeriod) {
    if (starting || isActiveMonthExport(job)) return;
    setStarting(period);
    try {
      const res = await fetch("/api/traffic/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const body = (await res.json().catch(() => null)) as {
        job?: MonthExportJobView;
        error?: string;
      } | null;
      if (!res.ok || !body?.job) {
        toast.error(body?.error?.trim() || "Не удалось начать выгрузку");
        return;
      }
      downloadedFor.current = null;
      setJob(body.job);
    } finally {
      setStarting(null);
    }
  }

  function closeResult() {
    dismissFinishedJob(job);
    downloadedFor.current = null;
    setJob(null);
  }

  const busy = starting != null || isActiveMonthExport(job);

  return (
    <>
      <Button
        type="button"
        disabled={busy}
        onClick={() => void start("previous")}
      >
        {starting === "previous" ? "Запуск…" : previousLabel}
      </Button>
      <Button
        type="button"
        disabled={busy}
        onClick={() => void start("current")}
      >
        {starting === "current" ? "Запуск…" : currentLabel}
      </Button>

      {job ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-popover shadow-lg">
            <div className="border-b px-4 py-3">
              <h2 className="text-base font-semibold">
                {job.title || "Выгрузка трафика"}
              </h2>
              {job.filename ? (
                <p className="text-xs text-muted-foreground">{job.filename}</p>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {job.stages.map((stage) => (
                <div
                  key={stage.id}
                  className="flex items-start justify-between gap-3"
                >
                  <div>
                    <p className="text-sm font-medium">{stage.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {stage.total != null
                        ? `${formatCount(stage.current ?? 0)} / ${formatCount(stage.total)}`
                        : (stage.detail ?? "")}
                      {stage.detail && stage.total != null
                        ? ` · ${stage.detail}`
                        : ""}
                    </p>
                  </div>
                  {stageBadge(stage.status)}
                </div>
              ))}
              {job.status === "failed" && job.errorMessage ? (
                <p className="text-sm text-destructive">{job.errorMessage}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3">
              {job.status === "completed" && job.downloadUrl ? (
                <Button asChild variant="outline" size="sm">
                  <a href={job.downloadUrl}>Скачать ещё раз</a>
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={isActiveMonthExport(job)}
                onClick={closeResult}
              >
                Закрыть
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
