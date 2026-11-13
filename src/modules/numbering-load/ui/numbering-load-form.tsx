"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseNumberingSourceOrigin } from "@/modules/numbering-load/origin";
import type { NumberingLoadView, NumberingSourceView } from "@/modules/numbering-load/schemas";

type Slot = "free" | "purchased";

type Draft = {
  baseUrl: string;
  token: string;
  hasToken: boolean;
};

type Confirm = {
  slot: Slot;
  origin: string | null;
  token: string;
};

const ENDPOINT: Record<Slot, string> = {
  free: "/api/numbering-load/free",
  purchased: "/api/numbering-load/purchased",
};

const TITLE: Record<Slot, string> = {
  free: "Свободные номера",
  purchased: "Купленные номера",
};

function draftFrom(source: NumberingSourceView): Draft {
  return { baseUrl: source.baseUrl ?? "", token: "", hasToken: source.hasToken };
}

export function NumberingLoadForm({ initial }: { initial: NumberingLoadView }) {
  const [free, setFree] = useState<Draft>(() => draftFrom(initial.free));
  const [purchased, setPurchased] = useState<Draft>(() => draftFrom(initial.purchased));
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function draft(slot: Slot): Draft {
    return slot === "free" ? free : purchased;
  }

  function setDraft(slot: Slot, next: Draft) {
    if (slot === "free") setFree(next);
    else setPurchased(next);
  }

  function openConfirm(slot: Slot) {
    if (pending) return;
    const current = draft(slot);
    const parsed = parseNumberingSourceOrigin(current.baseUrl);
    if (!parsed.ok) {
      setNote(null);
      setError(parsed.error);
      setConfirm(null);
      return;
    }
    setError(null);
    setNote(null);
    setConfirm({
      slot,
      origin: parsed.origin,
      token: current.token.trim(),
    });
  }

  async function save() {
    if (!confirm || pending) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const payload: { baseUrl: string; token?: string } = {
        baseUrl: confirm.origin ?? "",
      };
      if (confirm.token) payload.token = confirm.token;
      const response = await fetch(ENDPOINT[confirm.slot], {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        settings?: NumberingLoadView;
      } | null;
      if (!response.ok || !body?.settings) {
        setError(body?.error ?? "Не удалось сохранить настройки.");
        return;
      }
      setFree(draftFrom(body.settings.free));
      setPurchased(draftFrom(body.settings.purchased));
      setConfirm(null);
      setNote("Настройки сохранены.");
    } catch {
      setError("Не удалось сохранить настройки.");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape" && confirm) {
      event.preventDefault();
      setConfirm(null);
    }
  }

  return (
    <div className="max-w-xl space-y-8" onKeyDown={onKeyDown}>
      <SourceCard
        slot="free"
        draft={free}
        confirm={confirm?.slot === "free" ? confirm : null}
        pending={pending}
        onChange={(next) => setDraft("free", next)}
        onOpen={() => openConfirm("free")}
        onSave={() => void save()}
        onCancel={() => setConfirm(null)}
      />
      <SourceCard
        slot="purchased"
        draft={purchased}
        confirm={confirm?.slot === "purchased" ? confirm : null}
        pending={pending}
        onChange={(next) => setDraft("purchased", next)}
        onOpen={() => openConfirm("purchased")}
        onSave={() => void save()}
        onCancel={() => setConfirm(null)}
      />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
    </div>
  );
}

function SourceCard({
  slot,
  draft,
  confirm,
  pending,
  onChange,
  onOpen,
  onSave,
  onCancel,
}: {
  slot: Slot;
  draft: Draft;
  confirm: Confirm | null;
  pending: boolean;
  onChange: (next: Draft) => void;
  onOpen: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const urlId = `${slot}-source-url`;
  const tokenId = `${slot}-source-token`;
  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold">{TITLE[slot]}</h2>
      <div className="space-y-2">
        <Label htmlFor={urlId}>URL сервиса</Label>
        <Input
          id={urlId}
          value={draft.baseUrl}
          onChange={(event) => onChange({ ...draft, baseUrl: event.target.value })}
          placeholder="https://host"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={tokenId}>API-токен</Label>
        <Input
          id={tokenId}
          type="password"
          value={draft.token}
          onChange={(event) => onChange({ ...draft, token: event.target.value })}
          placeholder={
            draft.hasToken
              ? "Токен сохранён — вставьте новый, чтобы заменить"
              : "Вставьте API-токен"
          }
          autoComplete="new-password"
          spellCheck={false}
        />
        <p className="text-muted-foreground text-xs">
          {draft.hasToken ? "Токен сохранён" : "Токен ещё не задан"}
        </p>
      </div>
      <Button type="button" disabled={pending} onClick={onOpen}>
        Сохранить
      </Button>
      {confirm ? (
        <div
          role="dialog"
          aria-label="Подтверждение сохранения"
          className="space-y-3 rounded-md border p-4"
        >
          <p className="text-sm">
            {TITLE[slot]}
            <br />
            Хост: {confirm.origin ?? "—"}
            <br />
            {confirm.token ? "Токен будет сохранён." : "Токен останется прежним."}
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={pending} onClick={onSave}>
              {pending ? "Сохранение…" : "Сохранить"}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
