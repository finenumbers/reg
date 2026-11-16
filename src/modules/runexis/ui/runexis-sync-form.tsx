"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  ChainCardNote,
  useChainRunning,
} from "@/modules/numbering-chain/ui/chain-context";
import type { RunexisSyncView } from "@/modules/runexis/service";

export function RunexisSyncForm({ initial }: { initial: RunexisSyncView }) {
  const [view, setView] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const chainRunning = useChainRunning();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/numbering-sync/runexis");
      const body = (await response.json().catch(() => null)) as {
        settings?: RunexisSyncView;
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
        settings?: RunexisSyncView;
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

  const listName =
    view.list === "management" ? "Купленные" : view.list === "showcase" ? "Витрина" : "";
  const progress = !view.busy
    ? null
    : view.phase === "publishing"
      ? "Запись номеров"
      : view.list === "showcase"
        ? `Витрина, принято ${view.pageDone}`
        : view.pageTotal > 0
          ? `${listName ? `${listName}, страница` : "Страница"} ${view.pageDone} из ${view.pageTotal}`
          : "Загрузка";

  return (
    <div className="max-w-xl space-y-4" onKeyDown={onKeyDown}>
      <h2 className="text-base font-semibold">Runexis</h2>
      <p className="text-sm">Источник: Runexis</p>
      <p className="text-sm">Хост: {view.host}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={
            pending || view.busy || !view.hasPassword || !view.email || chainRunning
          }
          onClick={() => {
            setError(null);
            setConfirm(true);
          }}
        >
          Загрузить
        </Button>
        {view.hasLog ? (
          <Button type="button" variant="outline" asChild>
            <a href="/api/numbering-sync/runexis/log">Скачать лог</a>
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
            Источник: Runexis
            <br />
            Хост: {view.host}
            <br />
            Email: {view.email}
            <br />
            Будут заново прочитаны свободные и купленные номера. Успешная запись удалит
            все прежние номера Runexis в обоих каталогах, в том числе если новый список
            короче или пуст.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || chainRunning}
              onClick={() => void send("/api/numbering-sync/runexis")}
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
      <ChainCardNote source="runexis" />
      {view.busy && view.phase === "running" ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void send("/api/numbering-sync/runexis/cancel")}
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
