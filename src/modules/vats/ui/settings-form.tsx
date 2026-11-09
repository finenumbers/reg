"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { VatsCatalogs, VatsSettingsView } from "@/modules/vats/views";

type Confirm = {
  baseUrl: string;
  login: string;
  password: string;
};

function NameBlock({ title, names }: { title: string; names: string[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {names.length === 0 ? (
        <p className="text-muted-foreground text-sm">Нет данных.</p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-auto text-sm">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function VatsSettingsForm({
  initial,
  catalogs,
}: {
  initial: VatsSettingsView;
  catalogs: VatsCatalogs;
}) {
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [login, setLogin] = useState(initial.login);
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(initial.hasPassword);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function checkAccess() {
    if (pending) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/vats/access", { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        count?: number;
      } | null;
      if (!response.ok || !body || typeof body.count !== "number") {
        setError(body?.error ?? "Доступ не подтверждён.");
        return;
      }
      setNote(`Доступ есть. Доменов: ${body.count}.`);
    } catch {
      setError("Доступ не подтверждён.");
    } finally {
      setPending(false);
    }
  }

  async function save() {
    if (!confirm || pending) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const payload: { baseUrl: string; login: string; password?: string } = {
        baseUrl: confirm.baseUrl,
        login: confirm.login,
      };
      if (confirm.password.length > 0) payload.password = confirm.password;
      const response = await fetch("/api/vats/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        settings?: VatsSettingsView;
      } | null;
      if (!response.ok || !body?.settings) {
        setError(body?.error ?? "Не удалось сохранить настройки.");
        return;
      }
      setBaseUrl(body.settings.baseUrl);
      setLogin(body.settings.login);
      setHasPassword(body.settings.hasPassword);
      setPassword("");
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
    if (event.key === "Escape") {
      event.preventDefault();
      setConfirm(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="max-w-xl space-y-4">
        <div className="space-y-2">
          <Label htmlFor="vats-host">Хост платформы</Label>
          <Input
            id="vats-host"
            value={baseUrl}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://pbx.example"
            onChange={(event) => setBaseUrl(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vats-login">Логин</Label>
          <Input
            id="vats-login"
            value={login}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setLogin(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vats-password">Пароль</Label>
          <Input
            id="vats-password"
            type="password"
            value={password}
            autoComplete="off"
            placeholder={hasPassword ? "без изменений" : ""}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <p className="text-muted-foreground text-sm">
          Адрес выхода этого приложения должен быть в списке доверенных IP кабинета.
          Проверка доступа не доказывает право на запись.
        </p>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void checkAccess()}
          >
            Проверить доступ
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setConfirm({ baseUrl: baseUrl.trim(), login: login.trim(), password });
            }}
          >
            Сохранить
          </Button>
        </div>
        {confirm ? (
          <div
            role="dialog"
            aria-label="Подтверждение сохранения"
            className="space-y-3 rounded-md border p-4"
            onKeyDown={onKeyDown}
          >
            <p className="text-sm">
              Хост: {confirm.baseUrl || "—"}
              <br />
              Логин: {confirm.login || "—"}
              <br />
              {confirm.password.length > 0
                ? "Пароль будет сохранён."
                : "Пароль останется прежним."}
            </p>
            <div className="flex gap-2">
              <Button type="button" disabled={pending} onClick={() => void save()}>
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
      </div>
      <div className="max-w-xl space-y-4">
        <h2 className="text-sm font-medium">Справочники</h2>
        <p className="text-muted-foreground text-sm">Эти списки только для просмотра.</p>
        <NameBlock title="Шлюзы" names={catalogs.gateways} />
        <NameBlock title="Маршруты" names={catalogs.routes} />
        <NameBlock title="Диал-планы" names={catalogs.dialplans} />
      </div>
    </div>
  );
}
