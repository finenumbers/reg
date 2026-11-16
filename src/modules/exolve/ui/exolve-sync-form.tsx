"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  ChainCardNote,
  useChainRunning,
} from "@/modules/numbering-chain/ui/chain-context";
import type { ExolveSyncView } from "@/modules/exolve/service";

export function ExolveSyncForm({ initial }: { initial: ExolveSyncView }) {
  const [view, setView] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const chainRunning = useChainRunning();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/numbering-sync/exolve");
      const body = (await response.json().catch(() => null)) as {
        settings?: ExolveSyncView;
      } | null;
      if (response.ok && body?.settings) setView(body.settings);
    } catch {
      /* The next poll retries. */
    }
  }, []);

  useEffect(() => {
    if (!view.busy) return;
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [refresh, view.busy]);

  async function send(path: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        settings?: ExolveSyncView;
      } | null;
      if (body?.settings) setView(body.settings);
      if (!response.ok) {
        setError(body?.error ?? "Не удалось выполнить запрос.");
        return;
      }
      setConfirm(false);
    } catch {
      setError("Не удалось выполнить запрос.");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape" && confirm) {
      event.preventDefault();
      setConfirm(false);
    }
  }

  const progress = !view.busy
    ? null
    : view.phase === "publishing"
      ? "Запись номеров"
      : view.list === "free" && view.pageTotal > 0
        ? `Свободные: ячейка ${view.pageDone} из ${view.pageTotal}`
        : view.list === "purchased" && view.pageTotal > 0
          ? `Купленные: ${view.pageDone} из ${view.pageTotal}`
          : "Загрузка";

  return (
    <div className="max-w-xl space-y-4" onKeyDown={onKeyDown}>
      <h2 className="text-base font-semibold">MTS Exolve</h2>
      <p className="text-sm">Источник: MTS Exolve</p>
      <p className="text-sm">Хост: {view.host}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending || view.busy || !view.hasKey || chainRunning}
          onClick={() => {
            setError(null);
            setConfirm(true);
          }}
        >
          Загрузить
        </Button>
        {view.hasLog ? (
          <Button type="button" variant="outline" asChild>
            <a href="/api/numbering-sync/exolve/log">Скачать лог</a>
          </Button>
        ) : null}
      </div>
      {confirm ? (
        <div
          role="dialog"
          aria-label="Подтверждение загрузки"
          className="space-y-3 rounded-md border p-4"
        >
          <p className="text-sm">
            Источник: MTS Exolve
            <br />
            Хост: {view.host}
            <br />
            Будут заново прочитаны свободные и купленные номера. Успешная запись удалит
            все прежние номера MTS Exolve в обоих каталогах, в том числе если новый список
            короче или пуст.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || chainRunning}
              onClick={() => void send("/api/numbering-sync/exolve")}
            >
              {pending ? "Запуск…" : "Загрузить"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirm(false)}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
      {progress ? <p className="text-sm">{progress}</p> : null}
      <ChainCardNote source="exolve" />
      {view.busy && view.phase === "running" ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void send("/api/numbering-sync/exolve/cancel")}
        >
          Отмена
        </Button>
      ) : null}
      {!view.busy && view.lastError ? (
        <p className="text-destructive text-sm">{view.lastError}</p>
      ) : null}
      {!view.busy &&
      view.lastError == null &&
      view.lastFree != null &&
      view.lastPurchased != null ? (
        <p className="text-muted-foreground text-sm">
          Свободных: {view.lastFree}. Купленных: {view.lastPurchased}.
        </p>
      ) : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
