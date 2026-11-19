"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  ChainCardNote,
  useChainRunning,
  useParsedCount,
} from "@/modules/numbering-chain/ui/chain-context";
import type { AuroraSyncView } from "@/modules/aurora/service";
import { SourceCard } from "@/modules/numbering-sync/ui/source-card";

export function AuroraSyncForm({ initial }: { initial: AuroraSyncView }) {
  const [view, setView] = useState(initial);
  const gate = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const chainRunning = useChainRunning();
  const parsed = useParsedCount("aurora", view.lastFree, view.lastPurchased);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/numbering-sync/aurora");
      const body = (await response.json().catch(() => null)) as {
        settings?: AuroraSyncView;
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
        settings?: AuroraSyncView;
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
    : view.phase === "publishing"
      ? "Запись номеров"
      : view.pageTotal > 0
        ? `Ссылки: ${view.pageDone} из ${view.pageTotal}`
        : "Загрузка";

  return (
    <SourceCard
      name="Aurora Telecom"
      times={[{ label: "Свободные загружены", value: view.freeLoadedAtLabel }]}
      rows={[
        { label: "Свободные", value: view.freeShown },
        { label: "Разобрано", value: parsed },
      ]}
      loads={[
        {
          label: "Загрузить свободные",
          disabled: pending || view.busy || !view.hasFiles || chainRunning,
          onClick: () => void send("/api/numbering-sync/aurora"),
        },
      ]}
      logs={[
        {
          label: "Скачать лог",
          href: "/api/numbering-sync/aurora/log",
          hasLog: view.hasLog,
        },
      ]}
      onKeyDown={onKeyDown}
    >
      
      {progress ? <p className="text-sm">{progress}</p> : null}
      <ChainCardNote source="aurora" />
      {view.busy && view.phase === "running" ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void send("/api/numbering-sync/aurora/cancel")}
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
