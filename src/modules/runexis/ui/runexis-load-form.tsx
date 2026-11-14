"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RunexisAccessView } from "@/modules/runexis/service";

type Confirm = { email: string; password: string };

export function RunexisLoadForm({ initial }: { initial: RunexisAccessView }) {
  const [view, setView] = useState(initial);
  const [email, setEmail] = useState(initial.email);
  const [password, setPassword] = useState("");
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
        settings?: RunexisAccessView;
        ok?: boolean;
      } | null;
      if (body?.settings) {
        setView(body.settings);
        setEmail(body.settings.email);
      }
      if (!response.ok) {
        setError(body?.error ?? "Не удалось выполнить запрос.");
        return;
      }
      setConfirm(null);
      if (method === "PUT") {
        setPassword("");
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
    <div className="max-w-xl space-y-4" onKeyDown={onKeyDown}>
      <h2 className="text-base font-semibold">Runexis</h2>
      <div className="space-y-2">
        <Label>Хост</Label>
        <p className="text-sm">{view.host}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="runexis-email">Email</Label>
        <Input
          id="runexis-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          spellCheck={false}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="runexis-password">Пароль</Label>
        <Input
          id="runexis-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={
            view.hasPassword
              ? "Пароль сохранён — введите новый, чтобы заменить"
              : "Введите пароль"
          }
          autoComplete="new-password"
          spellCheck={false}
        />
        <p className="text-muted-foreground text-xs">
          {view.hasPassword ? "Пароль сохранён" : "Пароль ещё не задан"}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            const next = email.trim();
            setError(null);
            setNote(null);
            if (!next) {
              setError("Email ещё не задан.");
              return;
            }
            setConfirm({ email: next, password });
          }}
        >
          Сохранить
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !view.hasPassword || !view.email}
          onClick={() => void send("/api/numbering-load/runexis/test", "POST", {})}
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
            Runexis
            <br />
            Хост: {view.host}
            <br />
            Email: {confirm.email}
            <br />
            {confirm.password ? "Пароль будет сохранён." : "Пароль останется прежним."}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                void send("/api/numbering-load/runexis", "PUT", {
                  email: confirm.email,
                  password: confirm.password,
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
