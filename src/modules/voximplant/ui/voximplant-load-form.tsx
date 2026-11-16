"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { VoximplantAccessView } from "@/modules/voximplant/service";

type Confirm = { credentials: string; accountId: number };

function accountIdOf(text: string): number | null {
  try {
    const data = JSON.parse(text) as { account_id?: unknown };
    if (
      typeof data.account_id === "number" &&
      Number.isSafeInteger(data.account_id) &&
      data.account_id > 0
    ) {
      return data.account_id;
    }
  } catch {
    return null;
  }
  return null;
}

export function VoximplantLoadForm({ initial }: { initial: VoximplantAccessView }) {
  const [view, setView] = useState(initial);
  const [credentials, setCredentials] = useState("");
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
        settings?: VoximplantAccessView;
        ok?: boolean;
      } | null;
      if (body?.settings) setView(body.settings);
      if (!response.ok) {
        setError(body?.error ?? "Не удалось выполнить запрос.");
        return;
      }
      setConfirm(null);
      if (method === "PUT") {
        setCredentials("");
        setNote("Ключ сохранён.");
      }
      if (method === "POST") setNote("Доступ есть.");
    } catch {
      setError("Не удалось выполнить запрос.");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
    }
    if (event.key === "Escape" && confirm) {
      event.preventDefault();
      setConfirm(null);
    }
  }

  return (
    <div className="max-w-xl space-y-4" onKeyDown={onKeyDown}>
      <h2 className="text-base font-semibold">Voximplant</h2>
      <p className="text-sm">Хост: {view.host}</p>
      <div className="space-y-2">
        <Label htmlFor="voximplant-credentials">Ключ сервисного аккаунта</Label>
        <Textarea
          id="voximplant-credentials"
          value={credentials}
          onChange={(event) => setCredentials(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          rows={8}
          placeholder='{"account_id": 1, "key_id": "…", "private_key": "…"}'
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
            if (!credentials.trim()) {
              setNote("Ключ останется прежним.");
              return;
            }
            const accountId = accountIdOf(credentials);
            if (accountId == null) {
              setError("Проверьте ключ.");
              return;
            }
            setConfirm({ credentials, accountId });
          }}
        >
          Сохранить
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !view.hasKey}
          onClick={() => void send("/api/numbering-load/voximplant/test", "POST", {})}
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
            Voximplant
            <br />
            Хост: {view.host}
            <br />
            Учётная запись: {confirm.accountId}
            <br />
            Ключ будет заменён.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                void send("/api/numbering-load/voximplant", "PUT", {
                  credentials: confirm.credentials,
                })
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
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
    </div>
  );
}
