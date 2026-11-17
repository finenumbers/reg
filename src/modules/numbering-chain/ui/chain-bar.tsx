"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { ChainView } from "@/modules/numbering-chain/order";
import { useChainView, useNextRunLabel } from "@/modules/numbering-chain/ui/chain-context";
import { loadButtonClass } from "@/modules/numbering-sync/ui/source-card";

export function ChainBar() {
  const view = useChainView();
  const nextRunLabel = useNextRunLabel();
  const [pending, setPending] = useState(false);
  const gate = useRef(false);
  const [error, setError] = useState<string | null>(null);

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
        chain?: ChainView;
      } | null;
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

  return (
    <div className="max-w-xl space-y-4" onKeyDown={onKeyDown}>
      <p className="text-sm">
        Следующая автозагрузка: <span className="font-semibold">{nextRunLabel}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className={loadButtonClass}
          disabled={pending || view.running}
          onClick={() => void send("/api/numbering-sync/chain")}
        >
          Загрузить все
        </Button>
        {view.running ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void send("/api/numbering-sync/chain/cancel")}
          >
            Отмена
          </Button>
        ) : null}
      </div>
      <p className="text-sm">
        Источник без сохранённого секрета пропускается. Finenumbers секрета не требует.
      </p>
      {view.queue ? <p className="text-sm">{view.queue}</p> : null}
      {view.banner ? <p className="text-sm">{view.banner}</p> : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
