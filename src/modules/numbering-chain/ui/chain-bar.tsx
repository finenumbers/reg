"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { CHAIN_SOURCES, type ChainView } from "@/modules/numbering-chain/order";
import { useChainView, useNextRunLabel } from "@/modules/numbering-chain/ui/chain-context";
import { loadButtonClass } from "@/modules/numbering-sync/ui/source-card";

const NAMES = CHAIN_SOURCES.map((source) => source.label).join(", ");

export function ChainBar() {
  const view = useChainView();
  const nextRunLabel = useNextRunLabel();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        chain?: ChainView;
      } | null;
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
          onClick={() => {
            setError(null);
            setConfirm(true);
          }}
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
      {confirm ? (
        <div
          role="dialog"
          aria-label="Подтверждение цепочки загрузок"
          className="space-y-3 rounded-md border p-4"
        >
          <p className="text-sm">
            Будут по очереди загружены: {NAMES}.
            <br />
            Каждый источник заменяет только свои строки.
            <br />
            Источник без сохранённого секрета пропускается.
            <br />
            Ошибка одного не отменяет уже записанные номера.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              className={loadButtonClass}
              disabled={pending}
              onClick={() => void send("/api/numbering-sync/chain")}
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
      {view.queue ? <p className="text-sm">{view.queue}</p> : null}
      {view.banner ? <p className="text-sm">{view.banner}</p> : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
