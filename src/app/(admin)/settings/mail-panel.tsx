"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseRecipientText, type MailView } from "@/modules/mail/fields";

type SaveConfirm = {
  kind: "save";
  host: string;
  port: "" | "465" | "587";
  username: string;
  password: string;
  from: string;
  recipients: string;
};

type CheckConfirm = { kind: "check" };

function sameRecipients(text: string, saved: string[]): boolean {
  const parsed = parseRecipientText(text);
  if (!parsed.ok) return false;
  if (parsed.recipients.length !== saved.length) return false;
  return parsed.recipients.every((item, index) => item === saved[index]);
}

function recipientLine(text: string): string {
  const parsed = parseRecipientText(text);
  if (parsed.ok) return parsed.recipients.join(", ") || "—";
  return text.trim() || "—";
}

function savedReady(view: MailView): boolean {
  if (!view.host || !view.port || !view.from || view.recipients.length === 0)
    return false;
  if (view.username && !view.hasPassword) return false;
  return true;
}

export function MailPanel({ initial }: { initial: MailView }) {
  const [view, setView] = useState(initial);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState<"" | "465" | "587">(
    initial.port ? (String(initial.port) as "465" | "587") : "",
  );
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState(initial.from);
  const [recipients, setRecipients] = useState(initial.recipients.join("\n"));
  const [confirm, setConfirm] = useState<SaveConfirm | CheckConfirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const dirty =
    host.trim() !== view.host ||
    port !== (view.port ? String(view.port) : "") ||
    username.trim() !== view.username ||
    from.trim() !== view.from ||
    password.length > 0 ||
    !sameRecipients(recipients, view.recipients);

  async function send(path: string, method: "PUT" | "POST", payload?: unknown) {
    if (pending) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch(path, {
        method,
        headers:
          payload === undefined ? undefined : { "Content-Type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        mail?: MailView;
        test?: { detail?: string };
      } | null;
      if (body?.mail) {
        setView(body.mail);
        setHost(body.mail.host);
        setPort(body.mail.port ? (String(body.mail.port) as "465" | "587") : "");
        setUsername(body.mail.username);
        setFrom(body.mail.from);
        setRecipients(body.mail.recipients.join("\n"));
        setPassword("");
      }
      if (!response.ok) {
        setError(body?.error ?? "Не удалось выполнить запрос.");
        return;
      }
      setConfirm(null);
      setNote(
        method === "PUT"
          ? "Настройки сохранены."
          : (body?.test?.detail ?? "Письмо отправлено."),
      );
    } catch {
      setError("Не удалось выполнить запрос.");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape" && confirm && !pending) {
      event.preventDefault();
      setConfirm(null);
    }
  }

  return (
    <section className="max-w-xl space-y-4" onKeyDown={onKeyDown}>
      <h2 className="text-base font-semibold">Почта</h2>
      <p className="text-muted-foreground text-sm">
        Только отправка. Приём почты не используется. Порт — это порт отправки, 465 или
        587.
      </p>
      <div className="space-y-2">
        <Label htmlFor="mail-host">Сервер</Label>
        <Input
          id="mail-host"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="mail-port">Порт отправки</Label>
        <select
          id="mail-port"
          value={port}
          onChange={(event) => setPort(event.target.value as "" | "465" | "587")}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3"
        >
          <option value="">Выберите порт</option>
          <option value="465">465</option>
          <option value="587">587</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="mail-username">Логин</Label>
        <Input
          id="mail-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="mail-password">Пароль</Label>
        <Input
          id="mail-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={
            view.hasPassword ? "Пароль сохранён — вставьте новый, чтобы заменить" : ""
          }
          autoComplete="new-password"
          spellCheck={false}
        />
        <p className="text-muted-foreground text-xs">
          {view.hasPassword ? "Пароль сохранён" : "Пароль ещё не задан"}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="mail-from">От кого</Label>
        <Input
          id="mail-from"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="mail-to">Кому</Label>
        <Textarea
          id="mail-to"
          value={recipients}
          onChange={(event) => setRecipients(event.target.value)}
          placeholder={"one@example.com\ntwo@example.com"}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-muted-foreground text-xs">
          Один адрес на строку, не больше двадцати.
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={pending || confirm !== null}
          onClick={() => {
            setError(null);
            setNote(null);
            setConfirm({
              kind: "save",
              host,
              port,
              username,
              password,
              from,
              recipients,
            });
          }}
        >
          Сохранить
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || confirm !== null || dirty || !savedReady(view)}
          onClick={() => {
            setError(null);
            setNote(null);
            setConfirm({ kind: "check" });
          }}
        >
          Проверить
        </Button>
      </div>
      {confirm?.kind === "save" ? (
        <div
          role="dialog"
          aria-label="Подтверждение сохранения почты"
          className="space-y-3 rounded-md border p-4"
        >
          <p className="text-sm">
            Сервер: {confirm.host.trim() || "—"}
            <br />
            Порт: {confirm.port || "—"}
            <br />
            От кого: {confirm.from.trim() || "—"}
            <br />
            Кому: {recipientLine(confirm.recipients)}
            <br />
            {confirm.password ? "Пароль будет заменён." : "Пароль останется прежним."}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                const parsed = parseRecipientText(confirm.recipients);
                void send("/api/settings/mail", "PUT", {
                  host: confirm.host,
                  port: confirm.port === "" ? null : Number(confirm.port),
                  username: confirm.username,
                  password: confirm.password,
                  from: confirm.from,
                  recipients: parsed.ok
                    ? parsed.recipients
                    : confirm.recipients.split(/[\n,;]+/),
                });
              }}
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
      {confirm?.kind === "check" ? (
        <div
          role="dialog"
          aria-label="Подтверждение проверки почты"
          className="space-y-3 rounded-md border p-4"
        >
          <p className="text-sm">
            Будет отправлено одно письмо на сохранённые адреса.
            <br />
            Сервер: {view.host}
            <br />
            Кому: {view.recipients.join(", ")}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => void send("/api/settings/mail/test", "POST")}
            >
              {pending ? "Отправка…" : "Отправить"}
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
    </section>
  );
}
