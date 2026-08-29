"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TableCountFooter,
  TableInfiniteBody,
} from "@/components/table-infinite-body";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { fetchJobsList } from "@/modules/jobs/api-client";
import type { JobRunListItem, ListJobRunsResult } from "@/modules/jobs/query";
import {
  formatDurationMs,
  formatJobStatus,
  formatJobTimestamp,
  formatJobTrigger,
  jobStatusBadgeVariant,
  summarizeJobResult,
  type JobStatusFilter,
} from "@/modules/jobs/ui-format";
import { composeVoipmonitorJobsBanner } from "@/modules/voipmonitor/jobs-banner";

const PAGE_SIZE = TABLE_PAGE_SIZE;
const JOBS_POLL_MS = 4000;

function jobsPageSignature(data: ListJobRunsResult): string {
  return [
    data.total,
    data.voipmonitorUnenrichedCount,
    data.cdrEnrichUnenrichedCount ?? 0,
    ...data.items.map(
      (job) => `${job.id}:${job.status}:${job.finishedAt ?? ""}`,
    ),
  ].join("|");
}

type Props = {
  initial: ListJobRunsResult;
};

export function JobsView({ initial }: Props) {
  const { timeZone } = useDisplayTimezone();
  const [status, setStatus] = useState<JobStatusFilter>("");
  const [page, setPage] = useState(initial.page);
  const [items, setItems] = useState(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [unenriched, setUnenriched] = useState(
    initial.voipmonitorUnenrichedCount,
  );
  const [cdrEnrichUnenriched, setCdrEnrichUnenriched] = useState(
    initial.cdrEnrichUnenrichedCount ?? 0,
  );
  const [voipmonitorEnabled, setVoipmonitorEnabled] = useState(
    initial.voipmonitorEnabled,
  );
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const refreshSeq = useRef(0);
  const loadingMoreRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const pageSigRef = useRef(jobsPageSignature(initial));
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  const hasMore = items.length < total;

  async function loadList(
    opts: {
      status?: JobStatusFilter;
      page?: number;
      replace?: boolean;
    } = {},
  ) {
    const replace = opts.replace ?? true;
    const nextStatus = opts.status ?? status;
    const nextPage = opts.page ?? (replace ? 1 : page);
    const seq = ++refreshSeq.current;

    if (replace) {
      setLoading(true);
      loadingMoreRef.current = false;
      setLoadingMore(false);
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    setListError(null);

    const result = await fetchJobsList({
      status: nextStatus || undefined,
      page: nextPage,
      pageSize: PAGE_SIZE,
    });

    if (seq !== refreshSeq.current) return;

    if (!result.ok) {
      if (replace) {
        setItems([]);
        setTotal(0);
        setPage(1);
      }
      setListError(result.message);
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      return;
    }

    setTotal(result.data.total);
    setUnenriched(result.data.voipmonitorUnenrichedCount);
    setCdrEnrichUnenriched(result.data.cdrEnrichUnenrichedCount ?? 0);
    setVoipmonitorEnabled(result.data.voipmonitorEnabled);
    setPage(result.data.page);
    setItems((prev) =>
      replace ? result.data.items : [...prev, ...result.data.items],
    );
    if (replace) pageSigRef.current = jobsPageSignature(result.data);
    setLoading(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }

  useEffect(() => {
    return () => {
      refreshSeq.current += 1;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const applyPage = (data: ListJobRunsResult) => {
      pageSigRef.current = jobsPageSignature(data);
      setTotal(data.total);
      setUnenriched(data.voipmonitorUnenrichedCount);
      setCdrEnrichUnenriched(data.cdrEnrichUnenrichedCount ?? 0);
      setVoipmonitorEnabled(data.voipmonitorEnabled);
      setPage(data.page);
      setItems(data.items);
    };

    const pull = async () => {
      if (document.visibilityState === "hidden") return;
      const result = await fetchJobsList({
        status: statusRef.current || undefined,
        page: 1,
        pageSize: PAGE_SIZE,
      });
      if (cancelled || !result.ok) return;
      const sig = jobsPageSignature(result.data);
      if (sig === pageSigRef.current) return;
      applyPage(result.data);
    };

    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (cancelled || timer != null) return;
      timer = window.setInterval(() => {
        void pull();
      }, JOBS_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      void pull();
      start();
    };

    void pull();
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [status]);

  const onLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMoreRef.current) return;
    void loadList({ page: page + 1, replace: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, page, status]);

  const sentinelRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !listError,
    onLoadMore,
    root: scrollRoot,
  });

  function onStatusChange(next: JobStatusFilter) {
    setStatus(next);
    void loadList({ status: next, page: 1, replace: true });
  }

  function toggleExpand(job: JobRunListItem) {
    setExpandedId((cur) => (cur === job.id ? null : job.id));
  }

  const voipmonitorBanner = composeVoipmonitorJobsBanner({
    voipmonitorUnenriched: unenriched,
    voipmonitorEnabled,
    cdrEnrichUnenriched,
  });

  const emptyMessage = status
    ? "Нет запусков по текущему фильтру статуса."
    : "Запусков пока нет. Включите регулярную загрузку в Настройках или запустите задачу вручную.";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Задачи</h1>
        <p className="text-sm text-muted-foreground">
          История опросов и запусков задач из локальной базы. Сортировка по
          времени старта (сначала новые).
        </p>
      </div>

      {listError ? (
        <div
          role="alert"
          className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {listError}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-3"
            onClick={() => void loadList({ page: 1, replace: true })}
          >
            Повторить
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="jobs-status-filter">Статус</Label>
            <select
              id="jobs-status-filter"
              value={status}
              onChange={(e) =>
                onStatusChange(e.target.value as JobStatusFilter)
              }
              className="flex h-8 w-44 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Все</option>
              <option value="success">{formatJobStatus("success")}</option>
              <option value="failed">{formatJobStatus("failed")}</option>
              <option value="running">{formatJobStatus("running")}</option>
            </select>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadList({ page: 1, replace: true })}
            disabled={loading}
          >
            Обновить
          </Button>
        </div>
        {voipmonitorBanner ? (
          <div
            role="status"
            className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
          >
            {voipmonitorBanner}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TableInfiniteBody
            scrollRef={setScrollRoot}
            sentinelRef={sentinelRef}
            loadingMore={loadingMore}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Действие</TableHead>
                  <TableHead>Триггер</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Старт</TableHead>
                  <TableHead>Завершение</TableHead>
                  <TableHead>Длительность</TableHead>
                  <TableHead>Результат</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">
                      Загрузка…
                    </TableCell>
                  </TableRow>
                ) : null}
                {!loading && items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">
                      {emptyMessage}
                    </TableCell>
                  </TableRow>
                ) : null}
                {items.map((job) => {
                  const open = expandedId === job.id;
                  return (
                    <Fragment key={job.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => toggleExpand(job)}
                        data-state={open ? "selected" : undefined}
                      >
                        <TableCell className="text-xs">
                          {job.actionCode}
                        </TableCell>
                        <TableCell>{formatJobTrigger(job.trigger)}</TableCell>
                        <TableCell>
                          <Badge variant={jobStatusBadgeVariant(job.status)}>
                            {formatJobStatus(job.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatJobTimestamp(job.startedAt, timeZone)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatJobTimestamp(job.finishedAt, timeZone)}
                        </TableCell>
                        <TableCell className="tabular-nums text-sm">
                          {formatDurationMs(job.durationMs)}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                          {summarizeJobResult(job)}
                        </TableCell>
                      </TableRow>
                      {open ? (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/40 text-sm">
                            <dl className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <dt className="text-xs text-muted-foreground">
                                  Инициатор
                                </dt>
                                <dd>
                                  {job.actorUsername ??
                                    job.actorUserId ??
                                    "— (планировщик / система)"}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs text-muted-foreground">
                                  Код выхода
                                </dt>
                                <dd className="tabular-nums">
                                  {job.exitCode ?? "—"}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs text-muted-foreground">
                                  Артефакт
                                </dt>
                                <dd>
                                  {job.hasArtifact
                                    ? "Сохранён (действует retention; не отображается)"
                                    : "Нет"}
                                </dd>
                              </div>
                              <div className="sm:col-span-2">
                                <dt className="text-xs text-muted-foreground">
                                  Ошибка / сообщение
                                </dt>
                                <dd className="whitespace-pre-wrap break-words">
                                  {job.errorMessage?.trim() || "—"}
                                </dd>
                              </div>
                            </dl>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableInfiniteBody>
          <TableCountFooter shown={items.length} total={total} />
        </div>
      </div>
    </div>
  );
}

