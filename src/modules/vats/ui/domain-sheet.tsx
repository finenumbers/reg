"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { nameListHref } from "@/modules/vats/names";
import type { DomainSummary } from "@/modules/vats/rows";
import { DomainFieldEditor } from "@/modules/vats/ui/domain-card";

export function DomainSheet({
  domain,
  open,
  readAt,
  canWrite,
  onOpenChange,
}: {
  domain: string | null;
  open: boolean;
  readAt: string | null;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tracked, setTracked] = useState(domain);
  const [summary, setSummary] = useState<DomainSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const clearDraft = useRef<() => void>(() => {});
  const registerClear = useCallback((clear: () => void) => {
    clearDraft.current = clear;
  }, []);

  if (tracked !== domain) {
    setTracked(domain);
    setSummary(null);
    setError(null);
    setDrafting(false);
  }

  useEffect(() => {
    if (!open || !domain) return;
    const requested = domain;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/vats/domains/${encodeURIComponent(requested)}/summary`,
          { signal: controller.signal },
        );
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          summary?: DomainSummary;
        } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.summary || body.summary.name !== requested) {
          setError(body?.error ?? "Не удалось прочитать домен.");
          setSummary(null);
          return;
        }
        setError(null);
        setSummary(body.summary);
      } catch {
        if (controller.signal.aborted) return;
        setError("Не удалось прочитать домен.");
      }
    })();
    return () => controller.abort();
  }, [open, domain, readAt]);

  const shown = summary && summary.name === domain ? summary : null;
  const fields: Array<[string, string]> = shown
    ? [
        ["Абоненты", shown.subscribers],
        ["Запись разговоров", shown.recordDays],
        ["Речевая аналитика", shown.speechMinutes],
        ["Диал-план", shown.dialplan],
        ["Блокировка", shown.frozen],
        ["Язык", shown.language],
        ["Биллинг", shown.billing],
        ["Регион", shown.region],
        ["Длина внутреннего номера", shown.extDigits],
        ["Системный домен", shown.sysdomain],
      ]
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          if (!drafting) return;
          event.preventDefault();
          clearDraft.current();
        }}
      >
        <SheetHeader className="border-border border-b">
          <SheetTitle className="text-lg">{domain ?? "Домен"}</SheetTitle>
          <SheetDescription>Сводка из сохранённого снимка.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 p-4">
          {open && !shown && !error ? (
            <p className="text-muted-foreground text-sm">Загрузка деталей…</p>
          ) : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {shown ? (
            <dl className="grid grid-cols-[11rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Клиент</dt>
              <dd>{shown.client}</dd>
              <dt className="text-muted-foreground">Номера</dt>
              <dd>
                {shown.numbers == null ? (
                  "—"
                ) : (
                  <ul className="max-h-40 space-y-1 overflow-auto">
                    {shown.numbers.map((telnum) => (
                      <li key={telnum}>
                        <Link
                          href={nameListHref("/vats/telnums", telnum)}
                          className="tabular-nums hover:underline"
                        >
                          {telnum}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
              {fields.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {domain ? (
            <DomainFieldEditor
              key={domain}
              domain={domain}
              canWrite={canWrite}
              clientEditable
              languageEditable
              onDraftActive={setDrafting}
              registerClear={registerClear}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
