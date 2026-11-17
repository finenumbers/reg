"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  ChainCardNote,
  useChainRunning,
  useParsedCount,
} from "@/modules/numbering-chain/ui/chain-context";
import type { NumberingSyncView } from "@/modules/numbering-sync/service";
import { SourceCard } from "@/modules/numbering-sync/ui/source-card";

export function NumberingSyncForm({ initial }: { initial: NumberingSyncView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const gate = useRef(false);
  const chainRunning = useChainRunning();
  const parsed = useParsedCount("sipout", view.lastFree, view.lastPurchased);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/numbering-sync");
      const body = (await response.json().catch(() => null)) as {
        settings?: NumberingSyncView;
      } | null;
      if (response.ok && body?.settings) setView(body.settings);
    } catch {
      /* The next poll retries. */
    }
  }, []);

  useEffect(() => {
    if (!view.busy && !chainRunning) return;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
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
        settings?: NumberingSyncView;
      } | null;
      if (body?.settings) setView(body.settings);
      if (!response.ok) {
        setError(body?.error ?? "Не удалось выполнить запрос.");
        return;
      }
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
    : view.phase === "publishing" || view.step === "publishing"
      ? "Запись номеров"
      : view.step === "cities"
        ? "Чтение городов"
        : view.step === "free" && view.citiesTotal > 0
          ? `Свободные номера, город ${view.citiesDone} из ${view.citiesTotal}`
          : view.step === "purchased"
            ? "Купленные номера"
            : view.step === "split"
              ? "Расчёт ABC и города"
              : "Загрузка";

  return (
    <SourceCard
      name="SipOut"
      loadedAtLabel={view.loadedAtLabel}
      rows={[
        { label: "Купленные", value: view.purchasedShown },
        { label: "Свободные", value: view.freeShown },
        { label: "Дубликаты", value: view.duplicates },
        { label: "Разобрано", value: parsed },
      ]}
      loadDisabled={pending || view.busy || !view.hasKey || chainRunning}
      onLoad={() => void send("/api/numbering-sync/sipout")}
      hasLog={view.hasLog}
      logHref="/api/numbering-sync/sipout/log"
      onKeyDown={onKeyDown}
    >
      {progress ? <p className="text-sm">{progress}</p> : null}
      <ChainCardNote source="sipout" />
      {view.busy && view.phase === "running" ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void send("/api/numbering-sync/cancel")}
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
