"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { VatsDomainCard } from "@/modules/vats/card";

type Draft = {
  field: "client" | "language";
  expected: string | null;
  value: string;
};

function showText(value: string | null): string {
  if (!value) return "—";
  if (value.length > 300 || /[\u0000-\u001F\u007F]/.test(value)) return "—";
  return value;
}

function billingLabel(value: VatsDomainCard["billingType"]): string {
  if (value === "demo") return "Демо";
  if (value === "billable") return "Платный";
  return "—";
}

function yesNo(value: boolean | null): string {
  if (value == null) return "—";
  return value ? "Да" : "Нет";
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const nextValue = draft == null ? "" : draft.field === "client" ? draft.value.trim() : draft.value;
  const unchanged =
    draft != null &&
    (nextValue === (draft.expected ?? "") || (draft.field === "language" && nextValue === ""));

  async function openDraft(field: "client" | "language") {
    if (pending) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch(`/api/vats/domains/${encodeURIComponent(card.name)}`);
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        card?: VatsDomainCard;
      } | null;
      if (!response.ok || !body?.card) {
        setError(body?.error ?? "Не удалось прочитать домен.");
        return;
      }
      setCard(body.card);
      const expected = field === "client" ? body.card.client : body.card.language;
      setDraft({ field, expected, value: expected ?? "" });
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
      const response = await fetch(`/api/vats/domains/${encodeURIComponent(card.name)}`, {
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
      if (body?.card) setCard(body.card);
      if (!response.ok) {
        setDraft(null);
        setError(body?.error ?? "Не удалось изменить поле.");
        return;
      }
      setDraft(null);
      setNote(
        body?.sent
          ? "Поле изменено."
          : "Значение не изменилось. Запрос не отправлен.",
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
      setDraft(null);
    }
  }

  const rows: Array<[string, string]> = [
    ["Клиент", showText(card.client)],
    ["Язык", showText(card.language)],
    ["Биллинг", billingLabel(card.billingType)],
    ["Заморожен", yesNo(card.frozen)],
    ["Регион", showText(card.ownRegion)],
    ["Лимит абонентов", limitLabel(card.accountsLimit)],
    ["Абонентов", limitLabel(card.accountsCount)],
    ["Длина внутреннего номера", limitLabel(card.extDigits)],
    ["Системный домен", yesNo(card.sysdomain)],
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
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
      <dl className="max-w-xl space-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[14rem_1fr] gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {canWrite && !draft ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending || !card.clientEditable}
            onClick={() => void openDraft("client")}
          >
            Изменить клиента
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !card.languageEditable}
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
          className="max-w-xl space-y-3 rounded-md border p-4"
          onKeyDown={onKeyDown}
        >
          <p className="text-sm">
            Домен: {card.name}
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
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}
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
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}
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
            <Button type="button" variant="outline" disabled={pending} onClick={() => setDraft(null)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
