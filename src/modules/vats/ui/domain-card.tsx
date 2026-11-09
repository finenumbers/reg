"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { VatsDomainCard } from "@/modules/vats/card";
import { formatBilling, formatYesNo, showCell } from "@/modules/vats/labels";

type Draft = {
  field: "client" | "language";
  expected: string | null;
  value: string;
};

export function DomainFieldEditor({
  domain,
  canWrite,
  clientEditable,
  languageEditable,
  onCard,
  onDraftActive,
  registerClear,
}: {
  domain: string;
  canWrite: boolean;
  clientEditable: boolean;
  languageEditable: boolean;
  onCard?: (card: VatsDomainCard) => void;
  onDraftActive?: (active: boolean) => void;
  registerClear?: (clear: () => void) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tellDraft = useRef(onDraftActive);

  useEffect(() => {
    tellDraft.current = onDraftActive;
  }, [onDraftActive]);

  function updateDraft(next: Draft | null) {
    setDraft(next);
    tellDraft.current?.(next != null);
  }

  useEffect(() => {
    registerClear?.(() => {
      setDraft(null);
      tellDraft.current?.(false);
    });
  }, [registerClear]);

  const nextValue =
    draft == null ? "" : draft.field === "client" ? draft.value.trim() : draft.value;
  const unchanged =
    draft != null &&
    (nextValue === (draft.expected ?? "") ||
      (draft.field === "language" && nextValue === ""));

  async function openDraft(field: "client" | "language") {
    if (pending) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch(`/api/vats/domains/${encodeURIComponent(domain)}`);
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        card?: VatsDomainCard;
      } | null;
      if (!response.ok || !body?.card) {
        setError(body?.error ?? "Не удалось прочитать домен.");
        return;
      }
      onCard?.(body.card);
      if (field === "client" && !body.card.clientEditable) {
        setError("Поле нельзя изменить.");
        return;
      }
      if (field === "language" && !body.card.languageEditable) {
        setError("Поле нельзя изменить.");
        return;
      }
      const expected = field === "client" ? body.card.client : body.card.language;
      updateDraft({ field, expected, value: expected ?? "" });
    } catch {
      setError("Не удалось прочитать домен.");
    } finally {
      setPending(false);
    }
  }

  async function commit() {
    if (!draft || pending || unchanged) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch(`/api/vats/domains/${encodeURIComponent(domain)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: draft.field,
          value: nextValue,
          expected: draft.expected,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        card?: VatsDomainCard;
        sent?: boolean;
      } | null;
      if (body?.card) onCard?.(body.card);
      if (!response.ok) {
        updateDraft(null);
        setError(body?.error ?? "Не удалось изменить поле.");
        return;
      }
      updateDraft(null);
      setNote(
        body?.sent ? "Поле изменено." : "Значение не изменилось. Запрос не отправлен.",
      );
    } catch {
      setError("Не удалось изменить поле.");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape") {
      event.preventDefault();
      updateDraft(null);
    }
  }

  return (
    <div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {note ? <p className="text-muted-foreground mt-1 text-sm">{note}</p> : null}
      {canWrite && !draft ? (
        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending || !clientEditable}
            onClick={() => void openDraft("client")}
          >
            Изменить клиента
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !languageEditable}
            onClick={() => void openDraft("language")}
          >
            Изменить язык
          </Button>
        </div>
      ) : null}
      {draft ? (
        <div
          role="dialog"
          aria-label="Подтверждение изменения"
          className="mt-4 max-w-xl space-y-3 rounded-md border p-4"
          onKeyDown={onKeyDown}
        >
          <p className="text-sm">
            Домен: {domain}
            <br />
            Поле: {draft.field === "client" ? "Клиент" : "Язык"}
            <br />
            Было: {draft.expected ?? "—"}
          </p>
          {draft.field === "client" ? (
            <div className="space-y-2">
              <Label htmlFor="vats-client">Станет</Label>
              <Input
                id="vats-client"
                value={draft.value}
                maxLength={500}
                autoComplete="off"
                onChange={(event) => updateDraft({ ...draft, value: event.target.value })}
                onKeyDown={onKeyDown}
              />
              <p className="text-muted-foreground text-sm">
                Будет сохранено: {nextValue || "пусто"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="vats-language">Станет</Label>
              <select
                id="vats-language"
                className="border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm"
                value={draft.value}
                onChange={(event) => updateDraft({ ...draft, value: event.target.value })}
                onKeyDown={onKeyDown}
              >
                <option value="">Выберите</option>
                <option value="ru-RU">ru-RU</option>
                <option value="en-US">en-US</option>
              </select>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || unchanged}
              onClick={() => void commit()}
            >
              {pending ? "Изменение…" : "Изменить"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => updateDraft(null)}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function limitLabel(value: number | null): string {
  if (value == null) return "—";
  if (value === -1) return "без лимита";
  return String(value);
}

export function DomainCard({
  initial,
  canWrite,
}: {
  initial: VatsDomainCard;
  canWrite: boolean;
}) {
  const [card, setCard] = useState(initial);

  const rows: Array<[string, string]> = [
    ["Клиент", showCell(card.client)],
    ["Язык", showCell(card.language)],
    ["Биллинг", formatBilling(card.billingType)],
    ["Заморожен", formatYesNo(card.frozen)],
    ["Регион", showCell(card.ownRegion)],
    ["Лимит абонентов", limitLabel(card.accountsLimit)],
    ["Абонентов", limitLabel(card.accountsCount)],
    ["Длина внутреннего номера", limitLabel(card.extDigits)],
    ["Системный домен", formatYesNo(card.sysdomain)],
  ];

  return (
    <div className="h-full space-y-4 overflow-y-auto">
      <div>
        <p className="text-sm">
          <Link href="/vats" className="hover:underline">
            К списку доменов
          </Link>
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          {card.name}
        </h1>
      </div>
      <dl className="max-w-xl space-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[14rem_1fr] gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <DomainFieldEditor
        domain={card.name}
        canWrite={canWrite}
        clientEditable={card.clientEditable}
        languageEditable={card.languageEditable}
        onCard={setCard}
      />
    </div>
  );
}
