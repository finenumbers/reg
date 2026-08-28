"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  isFinishedEnrichJob,
  isResumableEnrichJob,
  type EnrichJobView,
  type EnrichStageView,
} from "@/modules/enrich/types";
import { formatEnrichSummary } from "@/modules/enrich/summary-format";

type ReadyState = {
  ready: boolean;
  hasPstnApiKey: boolean;
  hasGeoipApiKey: boolean;
};

type Props = {
  canOpenSettings: boolean;
  initialReady: ReadyState;
  initialJob: EnrichJobView | null;
};

function stageBadge(status: EnrichStageView["status"]) {
  if (status === "done") return <Badge variant="secondary">готово</Badge>;
  if (status === "running") return <Badge>идёт</Badge>;
  if (status === "error") return <Badge variant="destructive">ошибка</Badge>;
  return <Badge variant="outline">ожидание</Badge>;
}

function dismissFinishedJob(job: EnrichJobView | null) {
  if (!isFinishedEnrichJob(job) || !job) return;
  void fetch(`/api/enrich/${job.id}`, { method: "DELETE", keepalive: true });
}

export function EnrichView({
  canOpenSettings,
  initialReady,
  initialJob,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const downloadedFor = useRef<string | null>(null);
  const jobRef = useRef<EnrichJobView | null>(null);
  const [ready] = useState<ReadyState>(initialReady);
  const [job, setJob] = useState<EnrichJobView | null>(
    isResumableEnrichJob(initialJob) ? initialJob : null,
  );
  const [open, setOpen] = useState(isResumableEnrichJob(initialJob));
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  jobRef.current = job;

  const pollJob = useCallback(async (id: string) => {
    const res = await fetch(`/api/enrich/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { job: EnrichJobView };
    setJob(data.job);
    return data.job;
  }, []);

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
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
    const onPageHide = () => dismissFinishedJob(jobRef.current);
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (!isFinishedEnrichJob(jobRef.current)) return;
      setJob(null);
      setOpen(false);
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      dismissFinishedJob(jobRef.current);
    };
  }, []);

  function closeResult() {
    dismissFinishedJob(job);
    downloadedFor.current = null;
    setJob(null);
    setOpen(false);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!ready.ready) {
      toast.error("Сначала сохраните ключи PSTN и GeoIP в Настройках");
      return;
    }
    dismissFinishedJob(job);
    setUploading(true);
    setOpen(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/enrich", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось начать обогащение");
        setOpen(false);
        return;
      }
      const next = await pollJob(data.jobId as string);
      if (!next) toast.error("Задача создана, но статус недоступен");
    } catch {
      toast.error("Не удалось загрузить файл");
      setOpen(false);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const showSummary = job?.status === "completed" && job.summary;
  const blocked = !ready.ready;

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Обогатить данные
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Загрузите CSV с сырым трафиком. Сервис разберёт строки, дополнит
          описания номеров, PSTN и GeoIP и отдаст отформатированный XLSX.
        </p>
      </div>

      {blocked ? (
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">Сервисы не настроены</p>
          <p className="mt-1 text-muted-foreground">
            Нужны сохранённые API-ключи
            {!ready.hasPstnApiKey ? " PSTN" : ""}
            {!ready.hasPstnApiKey && !ready.hasGeoipApiKey ? " и" : ""}
            {!ready.hasGeoipApiKey ? " GeoIP" : ""}.
            {canOpenSettings
              ? " Откройте Настройки и сохраните ключи."
              : " Обратитесь к администратору."}
          </p>
          {canOpenSettings ? (
            <Button asChild className="mt-3" size="sm">
              <a href="/settings">Перейти в Настройки</a>
            </Button>
          ) : null}
        </div>
      ) : (
        <label
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center hover:bg-muted/40 ${
            dragOver ? "bg-muted/40" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void onFile(e.dataTransfer.files?.[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <span className="text-sm font-medium">
            {uploading ? "Загрузка…" : "Выберите CSV или перетащите файл сюда"}
          </span>
          <span className="text-xs text-muted-foreground">
            Разделитель «;», без заголовка. Имя файла может быть любым.
          </span>
        </label>
      )}

      {open && job ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-popover shadow-lg">
            <div className="border-b px-4 py-3">
              <h2 className="text-base font-semibold">
                {showSummary ? "Обогащение завершено" : "Обогащение данных"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {job.sourceFilename}
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {job.stages.map((stage) => (
                <div key={stage.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{stage.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {stage.total != null
                        ? `${stage.current ?? 0} / ${stage.total}`
                        : stage.detail ?? ""}
                      {stage.detail && stage.total != null ? ` · ${stage.detail}` : ""}
                    </p>
                  </div>
                  {stageBadge(stage.status)}
                </div>
              ))}
              {job.status === "failed" && job.errorMessage ? (
                <p className="text-sm text-destructive">{job.errorMessage}</p>
              ) : null}
              {showSummary ? (
                <div className="space-y-1.5 rounded-md border p-3 text-sm">
                  {formatEnrichSummary(job.summary!).map((row) => (
                    <div key={row.label} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="text-right font-medium">{row.value}</span>
                    </div>
                  ))}
                </div>
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
                disabled={job.status === "queued" || job.status === "running"}
                onClick={closeResult}
              >
                Закрыть
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
