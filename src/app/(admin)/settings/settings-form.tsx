"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { DISPLAY_TIMEZONES } from "@/lib/display-timezone";
import {
  DEFAULT_GEOIP_BASE_URL,
  DEFAULT_PSTN_BASE_URL,
  SAME_HOST_PSTN_BASE_URL,
  type SettingsView,
} from "@/modules/settings/schemas";
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
  const router = useRouter();
  const { setTimeZone } = useDisplayTimezone();
  const [settings, setSettings] = useState(initial);
  const [host, setHost] = useState(initial.host ?? "");
  const [port, setPort] = useState(String(initial.port ?? 22));
  const [username, setUsername] = useState(initial.username ?? "");
  const [displayTimezone, setDisplayTimezone] = useState(initial.displayTimezone);
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
  const [geoipBaseUrl, setGeoipBaseUrl] = useState(
    initial.geoipBaseUrl ?? DEFAULT_GEOIP_BASE_URL,
  );
  const [geoipApiKey, setGeoipApiKey] = useState("");
  const [geoipTestResult, setGeoipTestResult] = useState<TestResultView | null>(
    null,
  );
  const [pstnBaseUrl, setPstnBaseUrl] = useState(
    initial.pstnBaseUrl ?? DEFAULT_PSTN_BASE_URL,
  );
  const [pstnApiKey, setPstnApiKey] = useState("");
  const [pstnTestResult, setPstnTestResult] = useState<TestResultView | null>(
    null,
  );
  const [voipmonitorEnabled, setVoipmonitorEnabled] = useState(
    initial.voipmonitorEnabled,
  );
  const [voipmonitorApiUrl, setVoipmonitorApiUrl] = useState(
    initial.voipmonitorApiUrl ?? "",
  );
  const [voipmonitorUser, setVoipmonitorUser] = useState(
    initial.voipmonitorUser ?? "",
  );
  const [voipmonitorPassword, setVoipmonitorPassword] = useState("");
  const [voipmonitorGuiUrl, setVoipmonitorGuiUrl] = useState(
    initial.voipmonitorGuiUrl ?? "",
  );
  const [voipmonitorTestResult, setVoipmonitorTestResult] =
    useState<TestResultView | null>(null);
  const [ftpEnabled, setFtpEnabled] = useState(initial.ftpEnabled);
  const [ftpUsername, setFtpUsername] = useState(initial.ftpUsername ?? "");
  const [ftpPassword, setFtpPassword] = useState("");
  const [ftpListenPort, setFtpListenPort] = useState(
    String(initial.ftpListenPort),
  );
  const [ftpTestResult, setFtpTestResult] = useState<TestResultView | null>(
    null,
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
    setGeoipBaseUrl(next.geoipBaseUrl ?? DEFAULT_GEOIP_BASE_URL);
    setPstnBaseUrl(next.pstnBaseUrl ?? DEFAULT_PSTN_BASE_URL);
    setVoipmonitorEnabled(next.voipmonitorEnabled);
    setVoipmonitorApiUrl(next.voipmonitorApiUrl ?? "");
    setVoipmonitorUser(next.voipmonitorUser ?? "");
    setVoipmonitorGuiUrl(next.voipmonitorGuiUrl ?? "");
    setDisplayTimezone(next.displayTimezone);
    setTimeZone(next.displayTimezone);
    setFtpEnabled(next.ftpEnabled);
    setFtpUsername(next.ftpUsername ?? "");
    setFtpListenPort(String(next.ftpListenPort));
    router.refresh();
  }

  async function saveProfileFields(): Promise<SettingsView | null> {
    const body: Record<string, unknown> = {
      regsPollEnabled,
      regsPollIntervalSec: Number(regsPollIntervalSec),
      artifactRetentionDays: Number(artifactRetentionDays),
      artifactKeepLastRuns: Number(artifactKeepLastRuns),
      displayTimezone,
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

  async function saveGeoipUrl(): Promise<SettingsView | null> {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geoipBaseUrl: geoipBaseUrl.trim(),
        displayTimezone,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Не удалось сохранить URL GeoIP");
      return null;
    }
    return data.settings as SettingsView;
  }

  async function replaceGeoipKeyIfPresent(
    current: SettingsView,
  ): Promise<SettingsView | null> {
    const key = geoipApiKey.trim();
    if (!key) return current;
    const res = await fetch("/api/settings/geoip/key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Не удалось сохранить API-ключ GeoIP");
      applySettings(current);
      return null;
    }
    setGeoipApiKey("");
    return data.settings as SettingsView;
  }

  function onSaveGeoip() {
    startTransition(async () => {
      try {
        const hadKey = Boolean(geoipApiKey.trim());
        const saved = await saveGeoipUrl();
        if (!saved) return;
        const withKey = await replaceGeoipKeyIfPresent(saved);
        if (!withKey) return;
        applySettings(withKey);
        if (hadKey) {
          toast.success("URL и API-ключ GeoIP сохранены");
        } else if (withKey.hasGeoipApiKey) {
          toast.success("Настройки GeoIP сохранены");
        } else {
          toast.success(
            "URL сохранён — ещё нужен API-ключ перед «Проверить соединение»",
          );
        }
      } catch {
        toast.error("Не удалось сохранить GeoIP");
      }
    });
  }

  function onTestGeoip() {
    if (!settings.hasGeoipApiKey) {
      toast.error(
        "Сначала сохраните API-ключ GeoIP, затем проверьте соединение",
      );
      return;
    }
    startTransition(async () => {
      setGeoipTestResult(null);
      try {
        const res = await fetch("/api/settings/geoip/test", { method: "POST" });
        const data = await res.json();
        if (data.test) {
          setGeoipTestResult(data.test);
          if (data.test.result === "success") {
            toast.success("Тест GeoIP успешен");
          } else {
            toast.error(data.test.detail ?? "Тест GeoIP не удался");
          }
          return;
        }
        const message = data.detail ?? data.error ?? "Тест GeoIP не удался";
        toast.error(message);
        setGeoipTestResult({
          result: "error",
          detail: message,
          durationMs: null,
        });
      } catch {
        toast.error("Тест GeoIP не удался");
      }
    });
  }

  async function savePstnUrl(): Promise<SettingsView | null> {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pstnBaseUrl: pstnBaseUrl.trim(),
        displayTimezone,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Не удалось сохранить URL PSTN");
      return null;
    }
    return data.settings as SettingsView;
  }

  async function replacePstnKeyIfPresent(
    current: SettingsView,
  ): Promise<SettingsView | null> {
    const key = pstnApiKey.trim();
    if (!key) return current;
    const res = await fetch("/api/settings/pstn/key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Не удалось сохранить API-ключ PSTN");
      applySettings(current);
      return null;
    }
    setPstnApiKey("");
    return data.settings as SettingsView;
  }

  function onSavePstn() {
    startTransition(async () => {
      try {
        const hadKey = Boolean(pstnApiKey.trim());
        const saved = await savePstnUrl();
        if (!saved) return;
        const withKey = await replacePstnKeyIfPresent(saved);
        if (!withKey) return;
        applySettings(withKey);
        if (hadKey) {
          toast.success("URL и API-ключ PSTN сохранены");
        } else if (withKey.hasPstnApiKey) {
          toast.success("Настройки PSTN сохранены");
        } else {
          toast.success(
            "URL сохранён — ещё нужен API-ключ перед «Проверить соединение»",
          );
        }
      } catch {
        toast.error("Не удалось сохранить PSTN");
      }
    });
  }

  function onTestPstn() {
    if (!settings.hasPstnApiKey) {
      toast.error(
        "Сначала сохраните API-ключ PSTN, затем проверьте соединение",
      );
      return;
    }
    startTransition(async () => {
      setPstnTestResult(null);
      try {
        const res = await fetch("/api/settings/pstn/test", { method: "POST" });
        const data = await res.json();
        if (data.test) {
          setPstnTestResult(data.test);
          if (data.test.result === "success") {
            toast.success("Тест PSTN успешен");
          } else {
            toast.error(data.test.detail ?? "Тест PSTN не удался");
          }
          return;
        }
        const message = data.detail ?? data.error ?? "Тест PSTN не удался";
        toast.error(message);
        setPstnTestResult({
          result: "error",
          detail: message,
          durationMs: null,
        });
      } catch {
        toast.error("Тест PSTN не удался");
      }
    });
  }

  function onSaveVoipmonitor() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            voipmonitorEnabled,
            voipmonitorApiUrl: voipmonitorApiUrl.trim(),
            voipmonitorUser: voipmonitorUser.trim(),
            voipmonitorGuiUrl: voipmonitorGuiUrl.trim(),
            displayTimezone,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Не удалось сохранить VoIPmonitor");
          return;
        }
        let next = data.settings as SettingsView;
        const password = voipmonitorPassword.trim();
        if (password) {
          const keyRes = await fetch("/api/settings/voipmonitor/key", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
          const keyData = await keyRes.json();
          if (!keyRes.ok) {
            toast.error(keyData.error ?? "Не удалось сохранить пароль VoIPmonitor");
            applySettings(next);
            return;
          }
          setVoipmonitorPassword("");
          next = keyData.settings as SettingsView;
        }
        applySettings(next);
        toast.success("Настройки VoIPmonitor сохранены");
      } catch {
        toast.error("Не удалось сохранить VoIPmonitor");
      }
    });
  }

  function onTestVoipmonitor() {
    if (!settings.hasVoipmonitorPassword) {
      toast.error("Сначала сохраните пароль VoIPmonitor");
      return;
    }
    startTransition(async () => {
      setVoipmonitorTestResult(null);
      try {
        const res = await fetch("/api/settings/voipmonitor/test", {
          method: "POST",
        });
        const data = await res.json();
        if (data.test) {
          setVoipmonitorTestResult(data.test);
          if (data.test.result === "success") {
            toast.success("Тест VoIPmonitor успешен");
          } else {
            toast.error(data.test.detail ?? "Тест VoIPmonitor не удался");
          }
          return;
        }
        const message = data.detail ?? data.error ?? "Тест VoIPmonitor не удался";
        toast.error(message);
        setVoipmonitorTestResult({
          result: "error",
          detail: message,
          durationMs: null,
        });
      } catch {
        toast.error("Тест VoIPmonitor не удался");
      }
    });
  }

  async function onSaveFtp() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ftpEnabled,
            ftpUsername: ftpUsername.trim() || undefined,
            ftpListenPort: Number(ftpListenPort),
            displayTimezone,
          }),
        });
        const data = (await res.json()) as {
          settings?: SettingsView;
          error?: string;
        };
        if (!res.ok || !data.settings) {
          toast.error(data.error ?? "Не удалось сохранить FTP");
          return;
        }
        applySettings(data.settings);
        if (ftpPassword.trim()) {
          const keyRes = await fetch("/api/settings/ftp/key", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: ftpPassword }),
          });
          const keyData = (await keyRes.json()) as {
            settings?: SettingsView;
            error?: string;
          };
          if (!keyRes.ok || !keyData.settings) {
            toast.error(keyData.error ?? "Не удалось сохранить пароль FTP");
            return;
          }
          applySettings(keyData.settings);
          setFtpPassword("");
          toast.success("Настройки и пароль FTP сохранены");
          return;
        }
        toast.success("Настройки FTP сохранены");
      } catch {
        toast.error("Не удалось сохранить FTP");
      }
    });
  }

  async function onTestFtp() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings/ftp/test", { method: "POST" });
        const data = (await res.json()) as {
          test?: TestResultView;
          error?: string;
          detail?: string;
        };
        if (data.test) {
          setFtpTestResult(data.test);
          if (data.test.result === "success") {
            toast.success("FTP-слушатель активен");
          } else {
            toast.error(data.test.detail ?? "Тест FTP не удался");
          }
          return;
        }
        toast.error(data.detail ?? data.error ?? "Тест FTP не удался");
      } catch {
        toast.error("Тест FTP не удался");
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
        <h2 className="text-base font-semibold">Отображение</h2>
        <div className="space-y-2">
          <Label htmlFor="display-timezone">Часовой пояс дат</Label>
          <select
            id="display-timezone"
            value={displayTimezone}
            onChange={(e) => setDisplayTimezone(e.target.value)}
            className="flex h-8 w-full max-w-md rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {DISPLAY_TIMEZONES.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Даты в Регистрациях, Телефонных номерах, Входящих группах и Аудите.
            В телефонном трафике и выгрузке CDR — время как в файле звонка.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">SSH-профиль</h2>
        <div className="grid gap-4">
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
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <input
              id="poll-enabled"
              type="checkbox"
              className="size-4 rounded border"
              checked={regsPollEnabled}
              onChange={(e) => setRegsPollEnabled(e.target.checked)}
            />
            <Label htmlFor="poll-enabled">
              Включить регулярную загрузку регистраций, телефонных номеров и
              входящих групп
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            Один интервал на check_regs.sh и export.py (номера и входящие
            группы по очереди).
          </p>
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
            Регулярная загрузка: {regsPollEnabled ? "включена" : "выключена"}
            {" · "}
            Интервал: {regsPollIntervalSec} с
          </p>
          <Button type="button" disabled={pending} onClick={onSaveSettings}>
            Сохранить настройки
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">GeoIP</h2>
        <p className="text-sm text-muted-foreground">
          Внешний сервис аналитики ГРЧЦ: lookup страны, города и оператора связи
          по IP регистрации. Ключ хранится в зашифрованном виде и в UI не
          показывается — только замена.
        </p>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="geoip-url">URL сервиса</Label>
            <Input
              id="geoip-url"
              value={geoipBaseUrl}
              onChange={(e) => setGeoipBaseUrl(e.target.value)}
              placeholder={DEFAULT_GEOIP_BASE_URL}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="geoip-key">API-ключ External IP Lookup</Label>
            <Input
              id="geoip-key"
              type="password"
              value={geoipApiKey}
              onChange={(e) => setGeoipApiKey(e.target.value)}
              placeholder={
                settings.hasGeoipApiKey
                  ? "Ключ сохранён — вставьте новый, чтобы заменить"
                  : "Вставьте ключ из Admin GeoIP"
              }
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              {settings.hasGeoipApiKey ? (
                <Badge variant="secondary">ключ сохранён</Badge>
              ) : (
                "Ключ ещё не задан"
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={onSaveGeoip}>
              Сохранить GeoIP
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={
                pending || !settings.hasGeoipApiKey
              }
              onClick={onTestGeoip}
            >
              Проверить соединение
            </Button>
          </div>
          {geoipTestResult ? (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    geoipTestResult.result === "success"
                      ? "default"
                      : "destructive"
                  }
                >
                  {formatTestResultLabel(geoipTestResult.result)}
                </Badge>
                {geoipTestResult.durationMs != null ? (
                  <span className="text-xs text-muted-foreground">
                    {geoipTestResult.durationMs} мс
                  </span>
                ) : null}
              </div>
              {geoipTestResult.detail ? (
                <p className="mt-2 text-muted-foreground">
                  {geoipTestResult.detail}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">PSTN</h2>
        <p className="text-sm text-muted-foreground">
          Внешний сервис нумерации: оператор связи и территория ГАР по номеру
          телефона. Ключ хранится в зашифрованном виде и в UI не показывается —
          только замена.
        </p>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="pstn-url">URL сервиса</Label>
            <Input
              id="pstn-url"
              value={pstnBaseUrl}
              onChange={(e) => setPstnBaseUrl(e.target.value)}
              placeholder={DEFAULT_PSTN_BASE_URL}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Если PSTN на этом же Docker-хосте, укажите{" "}
              <span className="font-mono">{SAME_HOST_PSTN_BASE_URL}</span>, не
              публичный HTTPS — иначе «fetch failed» из‑за hairpin NAT.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pstn-key">API-ключ External Lookup</Label>
            <Input
              id="pstn-key"
              type="password"
              value={pstnApiKey}
              onChange={(e) => setPstnApiKey(e.target.value)}
              placeholder={
                settings.hasPstnApiKey
                  ? "Ключ сохранён — вставьте новый, чтобы заменить"
                  : "Вставьте ключ из Admin PSTN"
              }
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              {settings.hasPstnApiKey ? (
                <Badge variant="secondary">ключ сохранён</Badge>
              ) : (
                "Ключ ещё не задан"
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={onSavePstn}>
              Сохранить PSTN
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !settings.hasPstnApiKey}
              onClick={onTestPstn}
            >
              Проверить соединение
            </Button>
          </div>
          {pstnTestResult ? (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    pstnTestResult.result === "success"
                      ? "default"
                      : "destructive"
                  }
                >
                  {formatTestResultLabel(pstnTestResult.result)}
                </Badge>
                {pstnTestResult.durationMs != null ? (
                  <span className="text-xs text-muted-foreground">
                    {pstnTestResult.durationMs} мс
                  </span>
                ) : null}
              </div>
              {pstnTestResult.detail ? (
                <p className="mt-2 text-muted-foreground">
                  {pstnTestResult.detail}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">VoIPmonitor</h2>
        <p className="text-sm text-muted-foreground">
          Фоновая корреляция CDR со звонками в VoIPmonitor. Ссылка пишется
          только после подтверждённого совпадения. Пароль API хранится
          зашифрованным и в UI не показывается.
        </p>
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <input
              id="voipmonitor-enabled"
              type="checkbox"
              className="size-4 rounded border"
              checked={voipmonitorEnabled}
              onChange={(e) => setVoipmonitorEnabled(e.target.checked)}
            />
            <Label htmlFor="voipmonitor-enabled">Включить обогащение</Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="voipmonitor-api">API URL</Label>
            <Input
              id="voipmonitor-api"
              value={voipmonitorApiUrl}
              onChange={(e) => setVoipmonitorApiUrl(e.target.value)}
              placeholder="https://vm.example"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="voipmonitor-user">Пользователь</Label>
            <Input
              id="voipmonitor-user"
              value={voipmonitorUser}
              onChange={(e) => setVoipmonitorUser(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="voipmonitor-password">Пароль API</Label>
            <Input
              id="voipmonitor-password"
              type="password"
              value={voipmonitorPassword}
              onChange={(e) => setVoipmonitorPassword(e.target.value)}
              placeholder={
                settings.hasVoipmonitorPassword
                  ? "Пароль сохранён — вставьте новый, чтобы заменить"
                  : "Пароль пользователя VoIPmonitor"
              }
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="voipmonitor-gui">GUI URL</Label>
            <Input
              id="voipmonitor-gui"
              value={voipmonitorGuiUrl}
              onChange={(e) => setVoipmonitorGuiUrl(e.target.value)}
              placeholder="https://vm.example"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={onSaveVoipmonitor}>
              Сохранить VoIPmonitor
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !settings.hasVoipmonitorPassword}
              onClick={onTestVoipmonitor}
            >
              Проверить соединение
            </Button>
          </div>
          {voipmonitorTestResult ? (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    voipmonitorTestResult.result === "success"
                      ? "default"
                      : "destructive"
                  }
                >
                  {formatTestResultLabel(voipmonitorTestResult.result)}
                </Badge>
                {voipmonitorTestResult.durationMs != null ? (
                  <span className="text-xs text-muted-foreground">
                    {voipmonitorTestResult.durationMs} мс
                  </span>
                ) : null}
              </div>
              {voipmonitorTestResult.detail ? (
                <p className="mt-2 text-muted-foreground">
                  {voipmonitorTestResult.detail}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">FTP — телефонный трафик</h2>
        <p className="text-sm text-muted-foreground">
          Софтсвитч — FTP-клиент на своём реальном IP, активный режим, порт
          2121 на хосте Docker (не через NPM). Пароль хранится зашифрованным и
          в UI не показывается.
        </p>
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <input
              id="ftp-enabled"
              type="checkbox"
              className="size-4 rounded border"
              checked={ftpEnabled}
              onChange={(e) => setFtpEnabled(e.target.checked)}
            />
            <Label htmlFor="ftp-enabled">Включить FTP-приёмник</Label>
            {settings.ftpListenerActive ? (
              <Badge variant="secondary">слушатель активен</Badge>
            ) : (
              <Badge variant="outline">слушатель выключен</Badge>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ftp-username">Логин</Label>
            <Input
              id="ftp-username"
              value={ftpUsername}
              onChange={(e) => setFtpUsername(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ftp-password">Пароль</Label>
            <Input
              id="ftp-password"
              type="password"
              value={ftpPassword}
              onChange={(e) => setFtpPassword(e.target.value)}
              placeholder={
                settings.hasFtpPassword
                  ? "Пароль сохранён — вставьте новый, чтобы заменить"
                  : "Задайте пароль для софтсвитча"
              }
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              {settings.hasFtpPassword ? (
                <Badge variant="secondary">пароль сохранён</Badge>
              ) : (
                "Пароль ещё не задан"
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ftp-port">Порт</Label>
            <Input
              id="ftp-port"
              value={ftpListenPort}
              onChange={(e) => setFtpListenPort(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Софтсвитч подключается на IP хоста и этот порт. По умолчанию 2121.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={onSaveFtp}>
              Сохранить FTP
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onTestFtp}
            >
              Проверить слушатель
            </Button>
          </div>
          {ftpTestResult ? (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    ftpTestResult.result === "success"
                      ? "default"
                      : "destructive"
                  }
                >
                  {formatTestResultLabel(ftpTestResult.result)}
                </Badge>
                {ftpTestResult.durationMs != null ? (
                  <span className="text-xs text-muted-foreground">
                    {ftpTestResult.durationMs} мс
                  </span>
                ) : null}
              </div>
              {ftpTestResult.detail ? (
                <p className="mt-2 text-muted-foreground">
                  {ftpTestResult.detail}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
