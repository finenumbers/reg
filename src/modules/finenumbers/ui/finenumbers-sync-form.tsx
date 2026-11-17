"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  ChainCardNote,
  useChainRunning,
  useParsedCount,
} from "@/modules/numbering-chain/ui/chain-context";
import type { FinenumbersSyncView } from "@/modules/finenumbers/service";
import { SourceCard } from "@/modules/numbering-sync/ui/source-card";

export function FinenumbersSyncForm({ initial }: { initial: FinenumbersSyncView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const gate = useRef(false);
  const chainRunning = useChainRunning();
  const parsed = useParsedCount("finenumbers", view.lastFree, view.lastPurchased);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/numbering-sync/finenumbers");
      const body = (await response.json().catch(() => null)) as {
        settings?: FinenumbersSyncView;
      } | null;
      if (response.ok && body?.settings) setView(body.settings);
    } catch {
      /* The next poll retries. */
    }
  }, []);

  useEffect(() => {
    if (!view.busy && !chainRunning) return;
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    const start = setTimeout(() => {
      void refresh();
    }, 0);
    return () => {
      clearInterval(timer);
      clearTimeout(start);
    };
  }, [chainRunning, refresh, view.busy]);

  async function send(path: string) {
    if (gate.current) return;
    gate.current = true;
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
        settings?: FinenumbersSyncView;
      } | null;
      if (body?.settings) setView(body.settings);
      if (!response.ok) setError(body?.error ?? "Не удалось выполнить запрос.");
    } catch {
      setError("Не удалось выполнить запрос.");
    } finally {
      gate.current = false;
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") event.preventDefault();
  }

  const progress = !view.busy
    ? null
    : view.phase === "publishing"
      ? "Запись номеров"
      : view.pageTotal > 0
        ? `Диапазоны: ${view.pageDone} из ${view.pageTotal}`
        : "Загрузка";

  return (
    <SourceCard
      name="Finenumbers"
      loadedAtLabel={view.loadedAtLabel}
      rows={[
        { label: "Купленные", value: view.purchasedShown },
        { label: "Свободные", value: view.freeShown },
        { label: "Дубликаты", value: view.duplicates },
        { label: "Разобрано", value: parsed },
      ]}
      loadDisabled={pending || view.busy || chainRunning}
      onLoad={() => void send("/api/numbering-sync/finenumbers")}
      hasLog={view.hasLog}
      logHref="/api/numbering-sync/finenumbers/log"
      onKeyDown={onKeyDown}
    >
      <p className="text-sm">
        Успешная загрузка заменяет только строки Finenumbers. Берутся номера оператора с
        ИНН 5406978329.
      </p>
      {progress ? <p className="text-sm">{progress}</p> : null}
      <ChainCardNote source="finenumbers" />
      {view.busy && view.phase === "running" ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void send("/api/numbering-sync/finenumbers/cancel")}
        >
          Отмена
        </Button>
      ) : null}
      {!view.busy && view.lastError ? (
        <p className="text-destructive text-sm">{view.lastError}</p>
      ) : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </SourceCard>
  );
}
