"use client";

import { useEffect, useState } from "react";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { TableCountFooter } from "@/components/table-infinite-body";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount } from "@/lib/format-count";
import { formatDisplayTimestamp } from "@/lib/format-display-time";
import { LIVE_CALL_HEADERS, type LiveCallColumnKey } from "@/modules/live-calls/columns";
import type { LiveCallPayload, LiveCallRow } from "@/modules/live-calls/snapshot";
import { trafficMissingLabelClass } from "@/modules/traffic/ui-format";
import { cn } from "@/lib/utils";

const REFRESH_FALLBACK_MS = 3000;

function sideTrafficColumn(key: LiveCallColumnKey): string {
  if (key === "sideA") return "side_a";
  if (key === "sideB") return "side_b";
  return key;
}

export function LiveCallsView() {
  const { timeZone } = useDisplayTimezone();
  const [rows, setRows] = useState<LiveCallRow[] | null>(null);
  const [takenAt, setTakenAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let inFlight = false;
    let shownAt: string | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };

    const schedule = (ms: number) => {
      clearTimer();
      if (stopped || document.hidden) return;
      timer = setTimeout(() => {
        void tick();
      }, ms);
    };

    const tick = async () => {
      if (stopped || document.hidden || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/live-calls", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json()) as LiveCallPayload & {
          error?: string | null;
          code?: string;
        };
        if (stopped) return;
        if (!response.ok) {
          setError(response.status === 401 ? "Сессия истекла." : "Нет доступа.");
          setLoading(false);
          schedule(REFRESH_FALLBACK_MS);
          return;
        }
        const nextAt = body.takenAt;
        const older = Boolean(nextAt && shownAt && nextAt < shownAt);
        if (!older && body.rows) {
          setRows(body.rows);
          setTruncated(body.truncated);
          if (nextAt) {
            shownAt = nextAt;
            setTakenAt(nextAt);
          }
        }
        if (!older) setError(body.error);
        setLoading(false);
        schedule(body.refreshInMs ?? REFRESH_FALLBACK_MS);
      } catch (caught) {
        if (stopped || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setError("Нет соединения с сервером.");
        setLoading(false);
        schedule(REFRESH_FALLBACK_MS);
      } finally {
        inFlight = false;
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        clearTimer();
        return;
      }
      clearTimer();
      void tick();
    };

    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      stopped = true;
      clearTimer();
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const data = rows ?? [];
  const showLoading = loading && rows === null;
  const showEmpty = !showLoading && rows !== null && data.length === 0;
  const stamp = takenAt ? formatDisplayTimestamp(takenAt, timeZone) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Текущие звонки
        </h1>
        <p className="text-muted-foreground text-sm">
          Снимок текущих транзитных вызовов на момент запроса.
        </p>
        {stamp ? (
          <p className="text-muted-foreground text-sm">
            {error ? `Показан снимок ${stamp}. Новое чтение не удалось.` : `Снимок ${stamp}`}
          </p>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive shrink-0 rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </div>
      ) : null}
      {truncated ? (
        <div
          role="alert"
          className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
        >
          Показаны не все вызовы: таблица РТУ вернула 2000 строк, это потолок одного чтения.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {LIVE_CALL_HEADERS.map((column) => (
                  <TableHead key={column.key}>{column.header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {showLoading ? (
                <TableRow>
                  <TableCell colSpan={LIVE_CALL_HEADERS.length} className="text-muted-foreground h-24">
                    Загрузка…
                  </TableCell>
                </TableRow>
              ) : showEmpty ? (
                <TableRow>
                  <TableCell colSpan={LIVE_CALL_HEADERS.length} className="text-muted-foreground h-24">
                    Нет текущих звонков.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row) => (
                  <TableRow key={row.key}>
                    {LIVE_CALL_HEADERS.map((column) => (
                      <TableCell
                        key={column.key}
                        className={cn(
                          column.bold && "font-bold",
                          trafficMissingLabelClass(sideTrafficColumn(column.key), row[column.key]),
                        )}
                      >
                        {row[column.key]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {rows ? (
          truncated ? (
            <div className="border-border/60 text-muted-foreground shrink-0 border-t pt-3 text-xs">
              <p>Показано {formatCount(rows.length)}. Снимок обрезан.</p>
            </div>
          ) : (
            <TableCountFooter shown={rows.length} total={rows.length} />
          )
        ) : null}
      </div>
    </div>
  );
}
