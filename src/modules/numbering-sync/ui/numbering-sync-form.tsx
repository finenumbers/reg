"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NumberingSyncView } from "@/modules/numbering-sync/service";

type Confirm = { kind: "save"; token: string } | { kind: "free" } | { kind: "purchased" };

const CATALOG_LABEL: Record<string, string> = {
  free: "Свободные номера",
  purchased: "Купленные номера",
  check: "Проверка доступа",
};

function catalogLabel(catalog: string | null): string {
  if (!catalog) return "";
  return CATALOG_LABEL[catalog] ?? catalog;
}

export function NumberingSyncForm({ initial }: { initial: NumberingSyncView }) {
  const [view, setView] = useState(initial);
  const [token, setToken] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    if (!view.busy) return;
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [refresh, view.busy]);

  function apply(settings: NumberingSyncView | undefined) {
    if (settings) setView(settings);
  }

  async function send(path: string, method: "PUT" | "POST", payload?: unknown) {
    if (pending) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        settings?: NumberingSyncView;
        ok?: boolean;
      } | null;
      apply(body?.settings);
      if (!response.ok) {
        setError(body?.error ?? "Не удалось выполнить запрос.");
        return;
      }
      setConfirm(null);
      if (path.endsWith("/numbering-sync") && method === "PUT") {
        setToken("");
        setNote("Настройки сохранены.");
      } else if (path.endsWith("/test")) {
        setNote("Доступ есть.");
      }
    } catch {
      setError("Не удалось выполнить запрос.");
    } finally {
      setPending(false);
    }
  }

  function openSave() {
    if (pending || view.busy) return;
    setError(null);
    setNote(null);
    setConfirm({ kind: "save", token: token.trim() });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape" && confirm) {
      event.preventDefault();
      setConfirm(null);
    }
  }

  const progress =
    view.busy && view.catalog === "free" && view.citiesTotal > 0
      ? `Город ${view.citiesDone} из ${view.citiesTotal}`
      : view.busy && view.catalog === "purchased"
        ? view.phase === "publishing"
          ? "Запись купленных номеров"
          : "Чтение купленных номеров"
        : view.busy && view.phase === "publishing"
          ? "Запись номеров"
          : null;

  return (
    <div className="max-w-xl space-y-8" onKeyDown={onKeyDown}>
      <section className="space-y-4">
        <h2 className="text-base font-semibold">SipOut</h2>
        <div className="space-y-2">
          <Label>Хост</Label>
          <p className="text-sm">{view.host}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="sipout-key">Ключ API</Label>
          <Input
            id="sipout-key"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={
              view.hasKey
                ? "Ключ сохранён — вставьте новый, чтобы заменить"
                : "Вставьте ключ API"
            }
            autoComplete="new-password"
            spellCheck={false}
          />
          <p className="text-muted-foreground text-xs">
            {view.hasKey ? "Ключ сохранён" : "Ключ ещё не задан"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" disabled={pending || view.busy} onClick={openSave}>
            Сохранить
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || view.busy || !view.hasKey}
            onClick={() => void send("/api/numbering-sync/test", "POST", {})}
          >
            Проверить доступ
          </Button>
        </div>
        {confirm?.kind === "save" ? (
          <div
            role="dialog"
            aria-label="Подтверждение сохранения"
            className="space-y-3 rounded-md border p-4"
          >
            <p className="text-sm">
              SipOut
              <br />
              Хост: {view.host}
              <br />
              {confirm.token ? "Ключ будет сохранён." : "Ключ останется прежним."}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  void send(
                    "/api/numbering-sync",
                    "PUT",
                    confirm.token ? { token: confirm.token } : {},
                  )
                }
              >
                {pending ? "Сохранение…" : "Сохранить"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setConfirm(null)}
              >
                Отмена
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Загрузка</h2>
        <div className="space-y-2">
          <Label htmlFor="sipout-source">Источник</Label>
          <p id="sipout-source" className="text-sm">
            SipOut
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={pending || view.busy || !view.hasKey}
            onClick={() => {
              setError(null);
              setNote(null);
              setConfirm({ kind: "free" });
            }}
          >
            Свободные номера
          </Button>
          <Button
            type="button"
            disabled={pending || view.busy || !view.hasKey}
            onClick={() => {
              setError(null);
              setNote(null);
              setConfirm({ kind: "purchased" });
            }}
          >
            Купленные номера
          </Button>
        </div>
        {confirm?.kind === "free" || confirm?.kind === "purchased" ? (
          <div
            role="dialog"
            aria-label="Подтверждение загрузки"
            className="space-y-3 rounded-md border p-4"
          >
            <p className="text-sm">
              Источник: SipOut
              <br />
              Хост: {view.host}
              <br />
              {confirm.kind === "free" ? "Свободные номера" : "Купленные номера"}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  void send(
                    confirm.kind === "free"
                      ? "/api/numbering-sync/free"
                      : "/api/numbering-sync/purchased",
                    "POST",
                    {},
                  )
                }
              >
                {pending ? "Запуск…" : "Загрузить"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setConfirm(null)}
              >
                Отмена
              </Button>
            </div>
          </div>
        ) : null}
        {progress ? <p className="text-sm">{progress}</p> : null}
        {view.busy &&
        (view.catalog === "free" || view.catalog === "purchased") &&
        view.phase === "running" ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void send("/api/numbering-sync/cancel", "POST", {})}
          >
            Отмена
          </Button>
        ) : null}
        {!view.busy && view.lastError ? (
          <p className="text-destructive text-sm">
            {catalogLabel(view.lastCatalog)}
            {view.lastCatalog ? ": " : ""}
            {view.lastError}
          </p>
        ) : null}
        {!view.busy && view.lastError == null && view.lastWritten != null ? (
          <p className="text-muted-foreground text-sm">
            {catalogLabel(view.lastCatalog)}: записано {view.lastWritten}.
          </p>
        ) : null}
      </section>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
    </div>
  );
}
