"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SettingsView } from "@/modules/settings";
import { inspectKeyMaterial } from "@/modules/ssh/key-material-hint";

type Props = {
  initial: SettingsView;
};

type TestResultView = {
  result: string;
  detail: string | null;
  durationMs: number | null;
  mode?: string;
};

function formatTestResultLabel(result: string): string {
  if (result === "success") return "успех";
  if (result === "error" || result === "failed") return "ошибка";
  return result;
}

export function SettingsForm({ initial }: Props) {
  const [settings, setSettings] = useState(initial);
  const [host, setHost] = useState(initial.host ?? "");
  const [port, setPort] = useState(String(initial.port ?? 22));
  const [username, setUsername] = useState(initial.username ?? "");
  const [regsPollEnabled, setRegsPollEnabled] = useState(initial.regsPollEnabled);
  const [regsPollIntervalSec, setRegsPollIntervalSec] = useState(
    String(initial.regsPollIntervalSec),
  );
  const [artifactRetentionDays, setArtifactRetentionDays] = useState(
    String(initial.artifactRetentionDays),
  );
  const [artifactKeepLastRuns, setArtifactKeepLastRuns] = useState(
    String(initial.artifactKeepLastRuns),
  );
  const [passphrase, setPassphrase] = useState("");
  const [keyPaste, setKeyPaste] = useState("");
  const [keyFileLabel, setKeyFileLabel] = useState<string | null>(null);
  const [keySource, setKeySource] = useState<"none" | "file" | "paste">("none");
  const [keyHint, setKeyHint] = useState(() => inspectKeyMaterial(""));
  const [testResult, setTestResult] = useState<TestResultView | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const keyMaterialRef = useRef<string | null>(null);
  /** Ref avoids stale passphrase inside async save/replace transitions */
  const passphraseRef = useRef("");

  function setPassphraseValue(value: string) {
    passphraseRef.current = value;
    setPassphrase(value);
  }

  function clearKeySelection() {
    keyMaterialRef.current = null;
    setKeyPaste("");
    setKeyFileLabel(null);
    setKeySource("none");
    setKeyHint(inspectKeyMaterial(""));
    if (fileRef.current) fileRef.current.value = "";
  }

  function setKeyMaterial(raw: string, source: "file" | "paste", fileLabel?: string) {
    keyMaterialRef.current = raw;
    setKeyHint(inspectKeyMaterial(raw));
    setKeySource(source);
    if (source === "paste") {
      setKeyPaste(raw);
      setKeyFileLabel(null);
      if (fileRef.current) fileRef.current.value = "";
    } else {
      setKeyPaste("");
      setKeyFileLabel(fileLabel ?? "файл ключа");
    }
  }

  function applySettings(next: SettingsView) {
    setSettings(next);
    setHost(next.host ?? "");
    setPort(String(next.port ?? 22));
    setUsername(next.username ?? "");
    setRegsPollEnabled(next.regsPollEnabled);
    setRegsPollIntervalSec(String(next.regsPollIntervalSec));
    setArtifactRetentionDays(String(next.artifactRetentionDays));
    setArtifactKeepLastRuns(String(next.artifactKeepLastRuns));
  }

  async function saveProfileFields(): Promise<SettingsView | null> {
    const body: Record<string, unknown> = {
      regsPollEnabled,
      regsPollIntervalSec: Number(regsPollIntervalSec),
      artifactRetentionDays: Number(artifactRetentionDays),
      artifactKeepLastRuns: Number(artifactKeepLastRuns),
    };
    const hostTrimmed = host.trim();
    const usernameTrimmed = username.trim();
    const portNum = Number(port);
    if (hostTrimmed) body.host = hostTrimmed;
    if (usernameTrimmed) body.username = usernameTrimmed;
    if (Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535) {
      body.port = portNum;
    }

    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      const issues = Array.isArray(data.issues)
        ? data.issues
            .slice(0, 3)
            .map((i: { path?: unknown; message?: string }) => {
              const path = Array.isArray(i.path) ? i.path.join(".") : "";
              return path ? `${path}: ${i.message ?? ""}` : (i.message ?? "");
            })
            .filter(Boolean)
            .join("; ")
        : "";
      toast.error(
        issues || data.error || "Не удалось сохранить настройки",
      );
      return null;
    }
    return data.settings as SettingsView;
  }

  async function replaceKeyIfPresent(
    current: SettingsView,
  ): Promise<SettingsView | null> {
    const material = keyMaterialRef.current?.trim();
    if (!material) return current;

    const hint = inspectKeyMaterial(material);
    const pass = passphraseRef.current;
    if (hint.encrypted === true && !pass) {
      toast.error(
        "Этот ключ PuTTYgen (.ppk) зашифрован — введите passphrase ключа и сохраните снова",
      );
      applySettings(current);
      return null;
    }

    const res = await fetch("/api/settings/ssh/key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawKeyMaterial: material,
        // Do not trim passphrase — spaces may be significant
        passphrase: pass.length > 0 ? pass : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const code = data.code as string | undefined;
      if (code === "PASSPHRASE_REQUIRED") {
        toast.error(
          "Ключу PuTTYgen нужен passphrase — заполните поле «Passphrase ключа» ниже и сохраните снова",
        );
      } else if (code === "WRONG_PASSPHRASE") {
        toast.error("Неверный passphrase для этого ключа PuTTYgen / private key");
      } else if (code === "UNSUPPORTED_FORMAT") {
        toast.error(
          data.error ??
            "Неподдерживаемый формат — нужен private key PuTTYgen (.ppk) или PEM/OpenSSH",
        );
      } else {
        toast.error(data.error ?? "Не удалось импортировать ключ");
      }
      applySettings(current);
      return null;
    }
    setPassphraseValue("");
    clearKeySelection();
    return data.settings as SettingsView;
  }

  function onSaveSettings() {
    startTransition(async () => {
      try {
        const hadKeyInput = Boolean(keyMaterialRef.current?.trim());
        const saved = await saveProfileFields();
        if (!saved) return;

        const withKey = await replaceKeyIfPresent(saved);
        if (!withKey) return; // profile saved; key import failed (toast already shown)

        applySettings(withKey);
        if (hadKeyInput) {
          toast.success("SSH-профиль и private key сохранены");
        } else if (withKey.hasPrivateKey) {
          toast.success("SSH-профиль сохранён");
        } else {
          toast.success(
            "SSH-профиль сохранён — ещё нужен private key перед «Проверить соединение»",
          );
        }
      } catch {
        toast.error("Не удалось сохранить настройки");
      }
    });
  }

  async function onKeyFileChange(file: File | null) {
    if (!file) {
      if (keySource === "file") clearKeySelection();
      return;
    }
    const text = await file.text();
    setKeyMaterial(text, "file", file.name);
  }

  function onKeyPasteChange(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      if (keySource === "paste") clearKeySelection();
      else setKeyPaste(value);
      return;
    }
    setKeyMaterial(value, "paste");
  }

  function onReplaceKey() {
    const material = keyMaterialRef.current?.trim();
    if (!material) {
      toast.error(
        "Вставьте private key или выберите файл .ppk / PEM / OpenSSH",
      );
      return;
    }

    startTransition(async () => {
      try {
        // Ensure profile host/user exist before key-only replace
        const saved = await saveProfileFields();
        if (!saved) return;
        const withKey = await replaceKeyIfPresent(saved);
        if (!withKey) return;
        applySettings(withKey);
        toast.success("Private key заменён");
      } catch {
        toast.error("Не удалось импортировать ключ");
      }
    });
  }

  function onTestConnection() {
    if (!settings.hasPrivateKey) {
      toast.error(
        "Private key ещё не сохранён — вставьте/загрузите ключ и нажмите «Сохранить SSH-профиль» (или «Заменить private key»)",
      );
      return;
    }

    startTransition(async () => {
      setTestResult(null);
      try {
        const res = await fetch("/api/settings/ssh/test", { method: "POST" });
        const data = await res.json();
        if (data.test) {
          setTestResult(data.test);
          if (data.test.result === "success") {
            toast.success("Тест SSH-соединения успешен");
          } else {
            toast.error(data.test.detail ?? "Тест SSH-соединения не удался");
          }
          return;
        }
        const message =
          data.detail ?? data.error ?? "Тест SSH-соединения не удался";
        toast.error(message);
        setTestResult({
          result: "error",
          detail: message,
          durationMs: null,
        });
      } catch {
        toast.error("Тест SSH-соединения не удался");
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h2 className="text-base font-semibold">SSH-профиль</h2>
        <div className="grid max-w-xl gap-4">
          <div className="space-y-2">
            <Label htmlFor="host">Хост</Label>
            <Input
              id="host"
              name="host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="softswitch.example"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="port">Порт</Label>
            <Input
              id="port"
              name="port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">Имя пользователя</Label>
            <Input
              id="username"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label>Закрытый ключ</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={settings.hasPrivateKey ? "default" : "secondary"}>
                {settings.hasPrivateKey
                  ? "Ключ сохранён (маскирован)"
                  : "Нет ключа"}
              </Badge>
              {settings.keyAlgo ? (
                <Badge variant="outline">{settings.keyAlgo}</Badge>
              ) : null}
              {settings.keyFingerprint ? (
                <span className="text-xs text-muted-foreground break-all">
                  {settings.keyFingerprint}
                </span>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-paste">
                Вставить private key (поддерживается PuTTYgen .ppk)
              </Label>
              <Textarea
                id="key-paste"
                name="rawKeyMaterial"
                value={keyPaste}
                onChange={(e) => onKeyPasteChange(e.target.value)}
                placeholder={
                  "PuTTY-User-Key-File-3: ...\nor -----BEGIN OPENSSH PRIVATE KEY-----"
                }
                spellCheck={false}
                autoComplete="off"
                rows={8}
              />
              <div className="flex flex-wrap items-center gap-2">
                {keyHint.format === "ppk" ? (
                  <Badge variant="outline">Обнаружен: PuTTYgen .ppk</Badge>
                ) : null}
                {keyHint.format === "openssh" ? (
                  <Badge variant="outline">Обнаружен: OpenSSH</Badge>
                ) : null}
                {keyHint.format === "pem" ? (
                  <Badge variant="outline">Обнаружен: PEM</Badge>
                ) : null}
                {keyHint.encrypted === true ? (
                  <Badge variant="destructive">
                    Зашифрован — нужен passphrase
                  </Badge>
                ) : null}
                {keyHint.format === "ppk" && keyHint.encrypted === false ? (
                  <Badge variant="secondary">Незашифрованный PPK</Badge>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-file">
                Или загрузите файл ключа (.ppk / .pem)
              </Label>
              <Input
                id="key-file"
                ref={fileRef}
                type="file"
                accept=".ppk,.pem,.key,text/plain"
                onChange={(e) => onKeyFileChange(e.target.files?.[0] ?? null)}
              />
              {keySource === "file" && keyFileLabel ? (
                <p className="text-xs text-muted-foreground">
                  Выбрано для замены: {keyFileLabel}
                </p>
              ) : keySource === "paste" ? (
                <p className="text-xs text-muted-foreground">
                  Текст ключа готов к замене ({keyPaste.trim().length} символов).
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Сохранение только host/порта/имени пользователя не сохраняет
                  ключ.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-passphrase">
                Passphrase ключа
                {keyHint.encrypted === true
                  ? " (обязателен для этого .ppk)"
                  : ""}
              </Label>
              <Input
                id="key-passphrase"
                type="password"
                placeholder={
                  keyHint.encrypted === true
                    ? "Введите passphrase PuTTYgen, заданный при создании ключа"
                    : "Только если ключ зашифрован (PuTTYgen / PEM)"
                }
                value={passphrase}
                onChange={(e) => setPassphraseValue(e.target.value)}
                autoComplete="new-password"
                aria-required={keyHint.encrypted === true}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending} onClick={onSaveSettings}>
                Сохранить SSH-профиль
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending || keySource === "none"}
                onClick={onReplaceKey}
              >
                Заменить private key
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending || !settings.hasPrivateKey}
                onClick={onTestConnection}
              >
                Проверить соединение
              </Button>
            </div>
            {!settings.hasPrivateKey ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                «Проверить соединение» недоступно, пока private key не сохранён.
                Вставьте или загрузите ключ выше, затем нажмите{" "}
                <strong>Сохранить SSH-профиль</strong> (или{" "}
                <strong>Заменить private key</strong>). Одного host/имени
                пользователя недостаточно.
              </p>
            ) : null}
            {testResult ? (
              <div className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      testResult.result === "success" ? "default" : "destructive"
                    }
                  >
                    {formatTestResultLabel(testResult.result)}
                  </Badge>
                  {testResult.durationMs != null ? (
                    <span className="text-xs text-muted-foreground">
                      {testResult.durationMs} мс
                    </span>
                  ) : null}
                  {testResult.mode ? (
                    <span className="text-xs text-muted-foreground">
                      режим: {testResult.mode}
                    </span>
                  ) : null}
                </div>
                {testResult.detail ? (
                  <p className="mt-2 text-muted-foreground">{testResult.detail}</p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  Только auth/сессия — не запускает check_regs.sh и не обновляет
                  регистрации.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Опрос и артефакты</h2>
        <div className="grid max-w-xl gap-4">
          <div className="flex items-center gap-3">
            <input
              id="poll-enabled"
              type="checkbox"
              className="size-4 rounded border"
              checked={regsPollEnabled}
              onChange={(e) => setRegsPollEnabled(e.target.checked)}
            />
            <Label htmlFor="poll-enabled">
              Включить регулярный опрос регистраций
            </Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="interval">Интервал опроса (секунды)</Label>
            <Input
              id="interval"
              type="number"
              min={30}
              value={regsPollIntervalSec}
              onChange={(e) => setRegsPollIntervalSec(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="retention">Хранение артефактов (дни)</Label>
            <Input
              id="retention"
              type="number"
              min={1}
              value={artifactRetentionDays}
              onChange={(e) => setArtifactRetentionDays(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="keep-last">Хранить последние N запусков</Label>
            <Input
              id="keep-last"
              type="number"
              min={1}
              value={artifactKeepLastRuns}
              onChange={(e) => setArtifactKeepLastRuns(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {settings.schedulerLoopActive ? (
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                Фоновый цикл: работает
              </span>
            ) : (
              <span className="font-bold text-red-600 dark:text-red-400">
                Планировщик: не запущен
              </span>
            )}
            {" · "}
            Регулярный опрос: {regsPollEnabled ? "включён" : "выключен"}
            {" · "}
            Интервал: {regsPollIntervalSec} с
          </p>
          <Button type="button" disabled={pending} onClick={onSaveSettings}>
            Сохранить настройки
          </Button>
        </div>
      </section>
    </div>
  );
}
