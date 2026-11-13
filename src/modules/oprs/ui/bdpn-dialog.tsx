"use client";

import { useEffect, useId } from "react";
import { Button } from "@/components/ui/button";
import type { OprsBdpnHit } from "@/modules/oprs/api";

export type BdpnDialogState =
  | { phase: "loading" }
  | { phase: "hit"; hit: OprsBdpnHit }
  | { phase: "miss"; number: string }
  | { phase: "error"; message: string };

type Props = {
  state: BdpnDialogState | null;
  onClose: () => void;
};

export function BdpnDialog({ state, onClose }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-background relative z-10 w-full max-w-md rounded-md border p-4 shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold">
          Данные из БДПН:
        </h2>
        {state.phase === "loading" ? <p className="mt-3 text-sm">Проверка…</p> : null}
        {state.phase === "hit" ? <HitFields hit={state.hit} /> : null}
        {state.phase === "miss" ? (
          <div className="mt-3 space-y-2 text-sm">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
              <dt>Номер:</dt>
              <dd>{state.number}</dd>
            </dl>
            <p>В БДПН нет записи.</p>
          </div>
        ) : null}
        {state.phase === "error" ? <p className="mt-3 text-sm">{state.message}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </div>
  );
}

function HitFields({ hit }: { hit: OprsBdpnHit }) {
  return (
    <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
      <dt>Номер:</dt>
      <dd>{hit.number}</dd>
      <dt>Оператор:</dt>
      <dd>{hit.operator}</dd>
      <dt>Территория:</dt>
      <dd>{hit.territory}</dd>
      <dt>ИНН:</dt>
      <dd>{hit.inn}</dd>
    </dl>
  );
}
