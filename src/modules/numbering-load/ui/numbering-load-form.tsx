"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NumberingLoadView } from "@/modules/numbering-load/schemas";

type Confirm = { token: string };

export function NumberingLoadForm({ initial }: { initial: NumberingLoadView }) {
  const [view, setView] = useState(initial);
  const [token, setToken] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
        settings?: NumberingLoadView;
        ok?: boolean;
      } | null;
      if (body?.settings) setView(body.settings);
      if (!response.ok) {
        setError(body?.error ?? "Не удалось выполнить запрос.");
        return;
      }
      setConfirm(null);
      if (method === "PUT") {
        setToken("");
        setNote("Настройки сохранены.");
      } else {
        setNote("Доступ есть.");
      }
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
      setConfirm(null);
    }
  }

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
              view.hasKey ? "Ключ сохранён — вставьте новый, чтобы заменить" : "Вставьте ключ API"
            }
            autoComplete="new-password"
            spellCheck={false}
          />
          <p className="text-muted-foreground text-xs">
            {view.hasKey ? "Ключ сохранён" : "Ключ ещё не задан"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setNote(null);
              setConfirm({ token: token.trim() });
            }}
          >
            Сохранить
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !view.hasKey}
            onClick={() => void send("/api/numbering-load/test", "POST", {})}
          >
            Проверить доступ
          </Button>
        </div>
        {confirm ? (
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
                    "/api/numbering-load",
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
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
    </div>
  );
}
