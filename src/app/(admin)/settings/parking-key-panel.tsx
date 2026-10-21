"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ParkingKeyStatus } from "@/modules/antifraud/key-status";
import { inspectKeyMaterial } from "@/modules/ssh/key-material-hint";

function importError(code: string | undefined, fallback: string): string {
  if (code === "PASSPHRASE_REQUIRED") {
    return "Ключ зашифрован. Введите пароль ключа и сохраните снова.";
  }
  if (code === "WRONG_PASSPHRASE") return "Неверный пароль ключа.";
  if (code === "UNSUPPORTED_FORMAT") {
    return "Нужен закрытый ключ PuTTYgen (.ppk), PEM или OpenSSH.";
  }
  return fallback;
}

export function ParkingKeyPanel({ initial }: { initial: ParkingKeyStatus }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState(initial);
  const [host, setHost] = useState(initial.host);
  const [username, setUsername] = useState(initial.username);
  const [logPath, setLogPath] = useState(initial.logPath);
  const [savingTarget, setSavingTarget] = useState(false);
  const [keyPaste, setKeyPaste] = useState("");
  const [keyFileLabel, setKeyFileLabel] = useState<string | null>(null);
  const [material, setMaterial] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testDetail, setTestDetail] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);

  const hint = inspectKeyMaterial(material);

  function clearMaterial() {
    setMaterial("");
    setKeyPaste("");
    setKeyFileLabel(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onPaste(value: string) {
    setKeyPaste(value);
    setKeyFileLabel(null);
    setMaterial(value);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setMaterial(text);
    setKeyPaste("");
    setKeyFileLabel(file.name);
  }

  async function onSave() {
    const rawKeyMaterial = material.trim();
    if (!rawKeyMaterial) {
      toast.error("Вставьте закрытый ключ или выберите файл.");
      return;
    }
    if (hint.encrypted === true && passphrase.length === 0) {
      toast.error("Ключ зашифрован. Введите пароль ключа и сохраните снова.");
      return;
    }
    setSaving(true);
    setTestDetail(null);
    setTestOk(null);
    try {
      const res = await fetch("/api/settings/parking/key", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rawKeyMaterial,
          passphrase: passphrase.length > 0 ? passphrase : undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        code?: string;
        status?: ParkingKeyStatus;
      } | null;
      if (!res.ok || !body?.status) {
        toast.error(importError(body?.code, body?.error ?? "Не удалось сохранить ключ"));
        return;
      }
      setStatus((current) => ({
        ...current,
        configured: body.status?.configured ?? current.configured,
        fingerprint: body.status?.fingerprint ?? null,
        algo: body.status?.algo ?? null,
      }));
      setPassphrase("");
      clearMaterial();
      toast.success("Ключ сохранён. Журнал читается сам, раз в минуту.");
    } catch {
      toast.error("Не удалось сохранить ключ");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveTarget() {
    setSavingTarget(true);
    setTestDetail(null);
    setTestOk(null);
    try {
      const res = await fetch("/api/settings/parking/target", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host, username, logPath }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        status?: ParkingKeyStatus;
      } | null;
      if (!res.ok || !body?.status) {
        toast.error(body?.error ?? "Не удалось сохранить подключение");
        return;
      }
      setHost(body.status.host);
      setUsername(body.status.username);
      setLogPath(body.status.logPath);
      toast.success(
        body.status.configured
          ? "Подключение сохранено. Журнал читается сам, раз в минуту."
          : "Подключение сохранено. Чтение начнётся после ключа.",
      );
    } catch {
      toast.error("Не удалось сохранить подключение");
    } finally {
      setSavingTarget(false);
    }
  }

  async function onTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/parking/test", { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        detail?: string;
      } | null;
      if (!res.ok) {
        const detail = body?.detail ?? body?.error ?? "Проверка не удалась";
        setTestOk(false);
        setTestDetail(detail);
        toast.error(detail);
        return;
      }
      const detail = body?.detail ?? "Чтение calls.log доступно";
      setTestOk(true);
      setTestDetail(detail);
      toast.success(detail);
    } catch {
      setTestOk(false);
      setTestDetail("Проверка не удалась");
      toast.error("Проверка не удалась");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold">Доступ к Parking</h2>
      <p className="text-muted-foreground text-sm">
        Адрес, имя пользователя, закрытый ключ и файл лога для журнала АнтиФрод. Порт 22.
        Пароль ключа не сохраняется. После сохранения ключа журнал читается сам.
      </p>
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="parking-host">Адрес сервера</Label>
          <Input
            id="parking-host"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="parking-user">Имя пользователя</Label>
          <Input
            id="parking-user"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="parking-log">Расположение логов</Label>
          <Input
            id="parking-log"
            value={logPath}
            onChange={(event) => setLogPath(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div>
          <Button
            type="button"
            disabled={savingTarget}
            onClick={() => void onSaveTarget()}
          >
            {savingTarget ? "Сохранение…" : "Сохранить подключение"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.configured ? "default" : "secondary"}>
            {status.configured ? "Ключ сохранён (маскирован)" : "Нет ключа"}
          </Badge>
          {status.algo ? <Badge variant="outline">{status.algo}</Badge> : null}
          {status.fingerprint ? (
            <span className="text-muted-foreground text-xs break-all">
              {status.fingerprint}
            </span>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="parking-key-paste">Вставить закрытый ключ</Label>
          <Textarea
            id="parking-key-paste"
            value={keyPaste}
            onChange={(event) => onPaste(event.target.value)}
            placeholder={
              "-----BEGIN OPENSSH PRIVATE KEY-----\nили PuTTY-User-Key-File-3:"
            }
            spellCheck={false}
            autoComplete="off"
            rows={8}
          />
          <div className="flex flex-wrap items-center gap-2">
            {hint.format === "ppk" ? (
              <Badge variant="outline">Обнаружен: PuTTYgen .ppk</Badge>
            ) : null}
            {hint.format === "openssh" ? (
              <Badge variant="outline">Обнаружен: OpenSSH</Badge>
            ) : null}
            {hint.format === "pem" ? (
              <Badge variant="outline">Обнаружен: PEM</Badge>
            ) : null}
            {hint.encrypted === true ? (
              <Badge variant="destructive">Зашифрован — нужен пароль</Badge>
            ) : null}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="parking-key-file">Или выберите файл ключа</Label>
          <Input
            id="parking-key-file"
            ref={fileRef}
            type="file"
            onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
          />
          {keyFileLabel ? (
            <p className="text-muted-foreground text-xs">Выбран файл: {keyFileLabel}</p>
          ) : (
            <p className="text-muted-foreground text-xs">
              Тот же ключ, что для check.finenumbers.com. Файл может быть без расширения.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="parking-passphrase">
            Пароль ключа
            {hint.encrypted === true ? " (обязателен)" : ""}
          </Label>
          <Input
            id="parking-passphrase"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Только если ключ зашифрован"
            autoComplete="new-password"
            aria-required={hint.encrypted === true}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={saving || material.trim().length === 0}
            onClick={() => void onSave()}
          >
            {saving ? "Сохранение…" : "Сохранить ключ"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={testing || !status.configured}
            onClick={() => void onTest()}
          >
            {testing ? "Проверка…" : "Проверить чтение"}
          </Button>
        </div>
        {!status.configured ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Пока ключ не сохранён, журнал АнтиФрод пустой: читатель запускается сам, но
            подключаться ему нечем.
          </p>
        ) : null}
        {testDetail ? (
          <div className="rounded-md border p-3 text-sm">
            <Badge variant={testOk ? "default" : "destructive"}>
              {testOk ? "успех" : "ошибка"}
            </Badge>
            <p className="text-muted-foreground mt-2">{testDetail}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
