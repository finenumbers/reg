"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STATUS_ACTIVE, STATUS_BLOCKED } from "@/modules/phones/types";

export type ActivationTarget = {
  id: string;
  number: string;
  title: string;
  activation: string;
};

type Props = {
  target: ActivationTarget | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (phone: string) => void;
};

export function ActivationDialog({ target, pending, onClose, onConfirm }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, pending, onClose]);

  if (!target) return null;
  const next =
    target.activation === STATUS_ACTIVE
      ? STATUS_BLOCKED
      : target.activation === STATUS_BLOCKED
        ? STATUS_ACTIVE
        : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Закрыть"
        disabled={pending}
        onClick={() => {
          if (!pending) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-background relative z-10 w-full max-w-md rounded-md border p-4 shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold">
          Сменить статус
        </h2>
        <p className="mt-2 text-sm">
          {target.activation} → {next}. Номер {target.number}. {target.title}.
        </p>
        <p className="text-muted-foreground mt-2 text-sm">
          Введите номер ещё раз. После подтверждения статус проверяется загрузкой
          телефонных номеров.
        </p>
        <ActivationForm
          key={target.id}
          titleId={titleId}
          number={target.number}
          pending={pending}
          next={next}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      </div>
    </div>
  );
}

function ActivationForm({
  titleId,
  number,
  pending,
  next,
  onClose,
  onConfirm,
}: {
  titleId: string;
  number: string;
  pending: boolean;
  next: string;
  onClose: () => void;
  onConfirm: (phone: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const ready = phone.trim() === number && !pending && next.length > 0;

  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onConfirm(phone.trim());
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${titleId}-phone`}>Номер</Label>
        <Input
          id={`${titleId}-phone`}
          value={phone}
          autoFocus
          autoComplete="off"
          disabled={pending}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" disabled={!ready}>
          {pending ? "Проверяем…" : "Сменить статус"}
        </Button>
      </div>
    </form>
  );
}
