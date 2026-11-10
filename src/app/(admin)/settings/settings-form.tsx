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
  DEFAULT_DID_BASE_URL,
  DEFAULT_GEOIP_BASE_URL,
  DEFAULT_PSTN_BASE_URL,
  SAME_HOST_DID_BASE_URL,
  SAME_HOST_PSTN_BASE_URL,
  type SettingsView,
} from "@/modules/settings/schemas";
import { parseZabbixApiUrl } from "@/modules/zabbix/url";
import {
  GROUPS_SYNC_INTERVAL_SEC,
  PHONES_SYNC_INTERVAL_SEC,
  REGS_POLL_INTERVAL_SEC,
} from "@/modules/jobs/export-cadence";
import { inspectKeyMaterial } from "@/modules/ssh/key-material-hint";
import { SyslogSettings } from "@/modules/smg-syslog/ui/syslog-settings";
import type { ParkingKeyStatus } from "@/modules/antifraud/key-status";
import { ParkingKeyPanel } from "./parking-key-panel";

type Props = {
  initial: SettingsView;
  parkingKey: ParkingKeyStatus;
};

type TestResultView = {
  result: string;
  detail: string | null;
  durationMs: number | null;
  mode?: string;
};

type RtuProcedurePreview = {
  objectId: string;
  title: string;
  path: string;
};

type RtuTestView = TestResultView & {
  tableCount?: number;
  procedureCount?: number;
  procedures?: RtuProcedurePreview[];
  proceduresOmitted?: number;
  peerFingerprint?: string | null;
  peerSubject?: string | null;
};

function formatRtuResultLabel(result: string): string {
  if (result === "success") return "успех";
  if (result === "tls") return "сертификат";
  if (result === "timeout") return "таймаут";
  if (result === "wsdl") return "wsdl";
  if (result === "fault") return "отказ";
  if (result === "too_large") return "слишком большой ответ";
  if (result === "network") return "нет соединения";
  return "ошибка";
}

function formatTestResultLabel(result: string): string {
  if (result === "success") return "успех";
  if (result === "error" || result === "failed") return "ошибка";
  return result;
}

export function SettingsForm({ initial, parkingKey }: Props) {
  const router = useRouter();
  const { setTimeZone } = useDisplayTimezone();
  const [settings, setSettings] = useState(initial);
  const [host, setHost] = useState(initial.host ?? "");
  const [port, setPort] = useState(String(initial.port ?? 22));
  const [username, setUsername] = useState(initial.username ?? "");
  const [displayTimezone, setDisplayTimezone] = useState(initial.displayTimezone);
  const [regsPollEnabled, setRegsPollEnabled] = useState(initial.regsPollEnabled);
  const [exportSyncEnabled, setExportSyncEnabled] = useState(
    initial.exportSyncEnabled,
  );
  const [cdrSidesRefreshEnabled, setCdrSidesRefreshEnabled] = useState(
    initial.cdrSidesRefreshEnabled,
  );
  const [cdrSidesRefreshIntervalSec, setCdrSidesRefreshIntervalSec] = useState(
    String(initial.cdrSidesRefreshIntervalSec),
  );
  const [numberGeographyRefreshEnabled, setNumberGeographyRefreshEnabled] =
    useState(initial.numberGeographyRefreshEnabled);
  const [numberGeographyRefreshIntervalSec, setNumberGeographyRefreshIntervalSec] =
    useState(String(initial.numberGeographyRefreshIntervalSec));
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
  const [didBaseUrl, setDidBaseUrl] = useState(
    initial.didBaseUrl ?? DEFAULT_DID_BASE_URL,
  );
  const [didApiToken, setDidApiToken] = useState("");
  const [didTestResult, setDidTestResult] = useState<TestResultView | null>(
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
  const [zabbixApiUrl, setZabbixApiUrl] = useState(initial.zabbixApiUrl ?? "");
  const [zabbixUser, setZabbixUser] = useState(initial.zabbixUser ?? "");
  const [zabbixPassword, setZabbixPassword] = useState("");
  const [zabbixGraph1Host, setZabbixGraph1Host] = useState(
    initial.zabbixGraph1Host ?? "",
  );
  const [zabbixGraph1Name, setZabbixGraph1Name] = useState(
    initial.zabbixGraph1Name ?? "",
  );
  const [zabbixGraph2Host, setZabbixGraph2Host] = useState(
    initial.zabbixGraph2Host ?? "",
  );
  const [zabbixGraph2Name, setZabbixGraph2Name] = useState(
    initial.zabbixGraph2Name ?? "",
  );
  const [zabbixTestResult, setZabbixTestResult] = useState<TestResultView | null>(
    null,
  );
  const [rtuSoapBaseUrl, setRtuSoapBaseUrl] = useState(initial.rtuSoapBaseUrl ?? "");
  const [rtuSoapLogin, setRtuSoapLogin] = useState(initial.rtuSoapLogin ?? "");
  const [rtuSoapPassword, setRtuSoapPassword] = useState("");
  const [rtuSoapCaPem, setRtuSoapCaPem] = useState("");
  const [rtuSoapTestResult, setRtuSoapTestResult] = useState<RtuTestView | null>(
    null,
  );
  const [ftpEnabled, setFtpEnabled] = useState(initial.ftpEnabled);
  const [ftpUsername, setFtpUsername] = useState(initial.ftpUsername ?? "");
  const [ftpPassword, setFtpPassword] = useState("");
  const [ftpListenPort, setFtpListenPort] = useState(
    String(initial.ftpListenPort),
  );
  const [ftpPasvAddress, setFtpPasvAddress] = useState(
    initial.ftpPasvAddress ?? "",
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
    setExportSyncEnabled(next.exportSyncEnabled);
    setCdrSidesRefreshEnabled(next.cdrSidesRefreshEnabled);
    setCdrSidesRefreshIntervalSec(String(next.cdrSidesRefreshIntervalSec));
    setNumberGeographyRefreshEnabled(next.numberGeographyRefreshEnabled);
    setNumberGeographyRefreshIntervalSec(
      String(next.numberGeographyRefreshIntervalSec),
    );
    setArtifactRetentionDays(String(next.artifactRetentionDays));
    setArtifactKeepLastRuns(String(next.artifactKeepLastRuns));
    setGeoipBaseUrl(next.geoipBaseUrl ?? DEFAULT_GEOIP_BASE_URL);
    setPstnBaseUrl(next.pstnBaseUrl ?? DEFAULT_PSTN_BASE_URL);
    setDidBaseUrl(next.didBaseUrl ?? DEFAULT_DID_BASE_URL);
    setVoipmonitorEnabled(next.voipmonitorEnabled);
    setVoipmonitorApiUrl(next.voipmonitorApiUrl ?? "");
    setVoipmonitorUser(next.voipmonitorUser ?? "");
    setVoipmonitorGuiUrl(next.voipmonitorGuiUrl ?? "");
    setZabbixApiUrl(next.zabbixApiUrl ?? "");
    setZabbixUser(next.zabbixUser ?? "");
    setZabbixGraph1Host(next.zabbixGraph1Host ?? "");
    setZabbixGraph1Name(next.zabbixGraph1Name ?? "");
    setZabbixGraph2Host(next.zabbixGraph2Host ?? "");
    setZabbixGraph2Name(next.zabbixGraph2Name ?? "");
    setRtuSoapBaseUrl(next.rtuSoapBaseUrl ?? "");
    setRtuSoapLogin(next.rtuSoapLogin ?? "");
    setDisplayTimezone(next.displayTimezone);
    setTimeZone(next.displayTimezone);
    setFtpEnabled(next.ftpEnabled);
    setFtpUsername(next.ftpUsername ?? "");
    setFtpListenPort(String(next.ftpListenPort));
    setFtpPasvAddress(next.ftpPasvAddress ?? "");
    router.refresh();
  }

  async function saveProfileFields(): Promise<SettingsView | null> {
    const body: Record<string, unknown> = {
      regsPollEnabled,
      exportSyncEnabled,
      cdrSidesRefreshEnabled,
      cdrSidesRefreshIntervalSec: Number(cdrSidesRefreshIntervalSec),
      numberGeographyRefreshEnabled,
      numberGeographyRefreshIntervalSec: Number(numberGeographyRefreshIntervalSec),
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

  async function saveDidUrl(): Promise<SettingsView | null> {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        didBaseUrl: didBaseUrl.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Не удалось сохранить URL DID");
      return null;
    }
    return data.settings as SettingsView;
  }

  async function replaceDidTokenIfPresent(
    current: SettingsView,
  ): Promise<SettingsView | null> {
    const key = didApiToken.trim();
    if (!key) return current;
    const res = await fetch("/api/settings/did/key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Не удалось сохранить API-токен DID");
      applySettings(current);
      return null;
    }
    setDidApiToken("");
    return data.settings as SettingsView;
  }

  function onSaveDid() {
    startTransition(async () => {
      try {
        const hadKey = Boolean(didApiToken.trim());
        const saved = await saveDidUrl();
        if (!saved) return;
        const withKey = await replaceDidTokenIfPresent(saved);
        if (!withKey) return;
        applySettings(withKey);
        if (hadKey) {
          toast.success("URL и API-токен DID сохранены");
        } else if (withKey.hasDidApiToken) {
          toast.success("Настройки DID сохранены");
        } else {
          toast.success(
            "URL сохранён — ещё нужен API-токен перед «Проверить соединение»",
          );
        }
      } catch {
        toast.error("Не удалось сохранить DID");
      }
    });
  }

  function onTestDid() {
    if (!settings.hasDidApiToken) {
      toast.error(
        "Сначала сохраните API-токен DID, затем проверьте соединение",
      );
      return;
    }
    startTransition(async () => {
      setDidTestResult(null);
      try {
        const res = await fetch("/api/settings/did/test", { method: "POST" });
        const data = await res.json();
        if (data.test) {
          setDidTestResult(data.test);
          if (data.test.result === "success") {
            toast.success("Тест DID успешен");
          } else {
            toast.error(data.test.detail ?? "Тест DID не удался");
          }
          return;
        }
        const message = data.detail ?? data.error ?? "Тест DID не удался";
        toast.error(message);
        setDidTestResult({
          result: "error",
          detail: message,
          durationMs: null,
        });
      } catch {
        toast.error("Тест DID не удался");
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

  function zabbixSlotMessage(host: string, name: string, slot: string): string | null {
    const hostText = host.trim();
    const nameText = name.trim();
    if ((hostText.length === 0) !== (nameText.length === 0)) {
      return `График ${slot}: укажите хост и название`;
    }
    return null;
  }

  function onSaveZabbix() {
    const slotError =
      zabbixSlotMessage(zabbixGraph1Host, zabbixGraph1Name, "1") ??
      zabbixSlotMessage(zabbixGraph2Host, zabbixGraph2Name, "2");
    if (slotError) {
      toast.error(slotError);
      return;
    }
    if (zabbixApiUrl.trim() && !parseZabbixApiUrl(zabbixApiUrl)) {
      toast.error("Адрес Zabbix должен быть https без учётных данных");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            zabbixApiUrl: zabbixApiUrl.trim(),
            zabbixUser: zabbixUser.trim(),
            zabbixGraph1Host: zabbixGraph1Host.trim(),
            zabbixGraph1Name: zabbixGraph1Name.trim(),
            zabbixGraph2Host: zabbixGraph2Host.trim(),
            zabbixGraph2Name: zabbixGraph2Name.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          const issue = data.issues?.[0]?.message;
          toast.error(issue ?? data.error ?? "Не удалось сохранить Zabbix");
          return;
        }
        let next = data.settings as SettingsView;
        const password = zabbixPassword.trim();
        if (password) {
          const keyRes = await fetch("/api/settings/zabbix/key", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
          const keyData = await keyRes.json();
          if (!keyRes.ok) {
            toast.error(keyData.error ?? "Не удалось сохранить пароль Zabbix");
            applySettings(next);
            return;
          }
          setZabbixPassword("");
          next = keyData.settings as SettingsView;
        }
        applySettings(next);
        toast.success("Настройки Zabbix сохранены");
      } catch {
        toast.error("Не удалось сохранить Zabbix");
      }
    });
  }

  function onTestZabbix() {
    if (!settings.hasZabbixPassword) {
      toast.error("Сначала сохраните пароль Zabbix");
      return;
    }
    startTransition(async () => {
      setZabbixTestResult(null);
      try {
        const res = await fetch("/api/settings/zabbix/test", { method: "POST" });
        const data = await res.json();
        if (data.test) {
          setZabbixTestResult(data.test);
          if (data.test.result === "success") toast.success("Проверка Zabbix успешна");
          else toast.error(data.test.detail ?? "Проверка Zabbix не удалась");
          return;
        }
        const message = data.detail ?? data.error ?? "Проверка Zabbix не удалась";
        toast.error(message);
        setZabbixTestResult({ result: "error", detail: message, durationMs: null });
      } catch {
        toast.error("Проверка Zabbix не удалась");
      }
    });
  }

  function onSaveRtuSoap() {
    startTransition(async () => {
      try {
        const body: {
          rtuSoapBaseUrl: string;
          rtuSoapLogin: string;
          rtuSoapCaPem?: string;
        } = {
          rtuSoapBaseUrl: rtuSoapBaseUrl.trim(),
          rtuSoapLogin: rtuSoapLogin.trim(),
        };
        if (rtuSoapCaPem.trim().length > 0) body.rtuSoapCaPem = rtuSoapCaPem;
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          const issue = data.issues?.[0]?.message;
          toast.error(issue ?? data.error ?? "Не удалось сохранить API РТУ");
          return;
        }
        let next = data.settings as SettingsView;
        if (rtuSoapPassword.length > 0) {
          const keyRes = await fetch("/api/settings/rtu/key", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: rtuSoapPassword }),
          });
          const keyData = await keyRes.json();
          if (!keyRes.ok) {
            toast.error(keyData.error ?? "Не удалось сохранить пароль API РТУ");
            setRtuSoapCaPem("");
            applySettings(next);
            return;
          }
          setRtuSoapPassword("");
          next = keyData.settings as SettingsView;
        }
        setRtuSoapCaPem("");
        applySettings(next);
        toast.success("Учётная запись API РТУ сохранена");
      } catch {
        toast.error("Не удалось сохранить API РТУ");
      }
    });
  }

  function onClearRtuCa() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rtuSoapCaPem: "" }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Не удалось убрать сертификат API РТУ");
          return;
        }
        setRtuSoapCaPem("");
        applySettings(data.settings as SettingsView);
        toast.success("Сертификат API РТУ убран");
      } catch {
        toast.error("Не удалось убрать сертификат API РТУ");
      }
    });
  }

  function onTestRtuSoap() {
    if (
      !settings.hasRtuSoapPassword ||
      !settings.rtuSoapBaseUrl ||
      !settings.rtuSoapLogin
    ) {
      toast.error("Сначала сохраните URL, логин и пароль");
      return;
    }
    startTransition(async () => {
      setRtuSoapTestResult(null);
      try {
        const res = await fetch("/api/settings/rtu/test", { method: "POST" });
        const data = await res.json();
        if (data.test) {
          setRtuSoapTestResult(data.test);
          if (data.test.result === "success") {
            toast.success("Доступ к API РТУ есть");
          } else {
            toast.error(data.test.detail ?? "Проверка доступа не удалась");
          }
          return;
        }
        const message = data.error ?? "Проверка доступа не удалась";
        toast.error(message);
        setRtuSoapTestResult({
          result: "error",
          detail: message,
          durationMs: null,
        });
      } catch {
        toast.error("Проверка доступа не удалась");
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
            ftpPasvAddress,
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
            В левой навигации строка UTC+3 всегда Москва. Строка под ней — этот
            пояс (для UTC — UTC). В строках таблиц CDR и в выгрузке — время как
            в файле звонка.
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
                  Только auth/сессия — команду не отправляет и регистрации не обновляет.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">API РТУ</h2>
        <p className="text-sm text-muted-foreground">
          Учётная запись веб-интерфейса для чтения SOAP. Пароль хранится шифром
          и уходит только по HTTPS. «Проверить доступ» скачивает WSDL v2 и один
          раз вызывает getObjects: список таблиц и процедур, которые видит роль.
          Контекстные процедуры и маски записи в проверку не входят. Запись на
          коммутатор этот запрос не выполняет.
        </p>
        <p className="text-sm text-muted-foreground">
          Нужен отдельный пользователь с уже скомпилированной ролью, без смены
          пароля при следующем входе. Если в записи указан IP, это адрес, с
          которого выходит контейнер приложения. Для имени хоста достаточно
          публичного сертификата Let's Encrypt, поле «Сертификат» оставьте
          пустым. Проверка подписи и срока не отключается.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rtu-soap-url">URL</Label>
            <Input
              id="rtu-soap-url"
              value={rtuSoapBaseUrl}
              onChange={(event) => setRtuSoapBaseUrl(event.target.value)}
              placeholder="https://коммутатор"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rtu-soap-login">Логин</Label>
            <Input
              id="rtu-soap-login"
              value={rtuSoapLogin}
              onChange={(event) => setRtuSoapLogin(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="rtu-soap-password">Пароль</Label>
            <Input
              id="rtu-soap-password"
              type="password"
              value={rtuSoapPassword}
              onChange={(event) => setRtuSoapPassword(event.target.value)}
              placeholder={
                settings.hasRtuSoapPassword
                  ? "Пароль сохранён — введите новый, чтобы заменить"
                  : "Пароль веб-интерфейса"
              }
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="rtu-soap-ca">Сертификат</Label>
            <Textarea
              id="rtu-soap-ca"
              value={rtuSoapCaPem}
              onChange={(event) => setRtuSoapCaPem(event.target.value)}
              placeholder={
                settings.hasRtuSoapCa
                  ? "Сертификат сохранён — вставьте новый, чтобы заменить"
                  : "-----BEGIN CERTIFICATE-----"
              }
              autoComplete="off"
              spellCheck={false}
              rows={6}
              className="font-mono text-xs"
            />
          </div>
        </div>
        {settings.rtuSoapCaCerts.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {settings.rtuSoapCaCerts.map((cert) => (
              <li key={cert.fingerprint256}>
                {cert.subject || "сертификат"} — {cert.fingerprint256}
              </li>
            ))}
          </ul>
        ) : settings.hasRtuSoapCa ? (
          <p className="text-sm text-muted-foreground">
            Сохранённый сертификат не разбирается.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={onSaveRtuSoap}>
            Сохранить API РТУ
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !settings.hasRtuSoapCa}
            onClick={onClearRtuCa}
          >
            Убрать сертификат
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              pending ||
              !settings.hasRtuSoapPassword ||
              !settings.rtuSoapBaseUrl ||
              !settings.rtuSoapLogin
            }
            onClick={onTestRtuSoap}
          >
            Проверить доступ
          </Button>
        </div>
        {rtuSoapTestResult ? (
          <div className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  rtuSoapTestResult.result === "success" ? "default" : "destructive"
                }
              >
                {formatRtuResultLabel(rtuSoapTestResult.result)}
              </Badge>
              {rtuSoapTestResult.durationMs != null ? (
                <span className="text-xs text-muted-foreground">
                  {rtuSoapTestResult.durationMs} мс
                </span>
              ) : null}
            </div>
            {rtuSoapTestResult.detail ? (
              <p className="mt-2 text-muted-foreground">{rtuSoapTestResult.detail}</p>
            ) : null}
            {rtuSoapTestResult.peerFingerprint ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Сертификат на проводе
                {rtuSoapTestResult.peerSubject
                  ? `: ${rtuSoapTestResult.peerSubject}`
                  : ""}
                . {rtuSoapTestResult.peerFingerprint}
              </p>
            ) : null}
            {(rtuSoapTestResult.procedureCount ?? 0) > 0 ? (
              <p className="mt-2 text-amber-700 dark:text-amber-400">
                У роли есть процедуры. Приложение их не вызывает.
              </p>
            ) : null}
            {rtuSoapTestResult.procedures && rtuSoapTestResult.procedures.length > 0 ? (
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-muted-foreground">
                {rtuSoapTestResult.procedures.map((item) => (
                  <li key={item.objectId}>
                    {item.title || item.objectId}
                    {item.path ? ` — ${item.path}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            {(rtuSoapTestResult.proceduresOmitted ?? 0) > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Ещё {rtuSoapTestResult.proceduresOmitted}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <ParkingKeyPanel initial={parkingKey} />

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
              Включить регулярный опрос регистраций
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            Каждые {REGS_POLL_INTERVAL_SEC} секунд.
          </p>
          <div className="flex items-center gap-3">
            <input
              id="export-sync-enabled"
              type="checkbox"
              className="size-4 rounded border"
              checked={exportSyncEnabled}
              onChange={(e) => setExportSyncEnabled(e.target.checked)}
            />
            <Label htmlFor="export-sync-enabled">
              Включить регулярную загрузку телефонных номеров и входящих групп
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            Номера каждые {PHONES_SYNC_INTERVAL_SEC} секунд, входящие группы
            каждые {GROUPS_SYNC_INTERVAL_SEC} секунд. Новая загрузка не стартует,
            пока идёт опрос регистраций или другая загрузка каталога.
          </p>
          <div className="flex items-center gap-3">
            <input
              id="sides-refresh-enabled"
              type="checkbox"
              className="size-4 rounded border"
              checked={cdrSidesRefreshEnabled}
              onChange={(e) => setCdrSidesRefreshEnabled(e.target.checked)}
            />
            <Label htmlFor="sides-refresh-enabled">
              Обновлять описания сторон в журнале звонков
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            Подставляет Описание из справочника в уже загруженные звонки, когда
            оно появилось или изменилось. После успешной загрузки номеров
            запускается сразу. Поиск в трафике по-прежнему за весь выбранный месяц.
          </p>
          <div className="space-y-2">
            <Label htmlFor="sides-refresh-interval">
              Интервал обновления описаний в журнале (секунды)
            </Label>
            <Input
              id="sides-refresh-interval"
              type="number"
              min={30}
              value={cdrSidesRefreshIntervalSec}
              onChange={(e) => setCdrSidesRefreshIntervalSec(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              id="rtu-refresh-enabled"
              type="checkbox"
              className="size-4 rounded border"
              checked={numberGeographyRefreshEnabled}
              onChange={(e) =>
                setNumberGeographyRefreshEnabled(e.target.checked)
              }
            />
            <Label htmlFor="rtu-refresh-enabled">
              Автообновление раздела «Управление РТУ»
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            Пока раздел открыт, таблица перечитывает каталог. Номера, тариф и
            кэш PSTN по-прежнему обновляются своими расписаниями.
          </p>
          <div className="space-y-2">
            <Label htmlFor="rtu-refresh-interval">
              Интервал автообновления раздела «Управление РТУ» (секунды)
            </Label>
            <Input
              id="rtu-refresh-interval"
              type="number"
              min={30}
              value={numberGeographyRefreshIntervalSec}
              onChange={(e) =>
                setNumberGeographyRefreshIntervalSec(e.target.value)
              }
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
            Регистрации: {regsPollEnabled ? "вкл" : "выкл"} / {REGS_POLL_INTERVAL_SEC}{" "}
            с
            {" · "}
            Номера: {exportSyncEnabled ? "вкл" : "выкл"} / {PHONES_SYNC_INTERVAL_SEC} с
            {" · "}
            Группы: {exportSyncEnabled ? "вкл" : "выкл"} / {GROUPS_SYNC_INTERVAL_SEC} с
            {" · "}
            Описания в журнале: {cdrSidesRefreshEnabled ? "вкл" : "выкл"} /{" "}
            {cdrSidesRefreshIntervalSec} с
            {" · "}
            Управление РТУ: {numberGeographyRefreshEnabled ? "вкл" : "выкл"} /{" "}
            {numberGeographyRefreshIntervalSec} с
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
        <h2 className="text-base font-semibold">DID</h2>
        <p className="text-sm text-muted-foreground">
          Каталог свободных и купленных номеров. Токен — ADMIN_API_TOKEN DID. Он хранится
          в зашифрованном виде и в UI не показывается — только замена. Это
          полный доступ к API DID.
        </p>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="did-url">URL сервиса</Label>
            <Input
              id="did-url"
              value={didBaseUrl}
              onChange={(e) => setDidBaseUrl(e.target.value)}
              placeholder={DEFAULT_DID_BASE_URL}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Если DID на этом же Docker-хосте, укажите{" "}
              <span className="font-mono">{SAME_HOST_DID_BASE_URL}</span>, не
              публичный HTTPS — иначе «fetch failed» из‑за hairpin NAT. Пустое
              поле снова сохраняет{" "}
              <span className="font-mono">{DEFAULT_DID_BASE_URL}</span>.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="did-key">API-токен</Label>
            <Input
              id="did-key"
              type="password"
              value={didApiToken}
              onChange={(e) => setDidApiToken(e.target.value)}
              placeholder={
                settings.hasDidApiToken
                  ? "Токен сохранён — вставьте новый, чтобы заменить"
                  : "Вставьте ADMIN_API_TOKEN DID"
              }
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              {settings.hasDidApiToken ? (
                <Badge variant="secondary">токен сохранён</Badge>
              ) : (
                "Токен ещё не задан"
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={onSaveDid}>
              Сохранить DID
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !settings.hasDidApiToken}
              onClick={onTestDid}
            >
              Проверить соединение
            </Button>
          </div>
          {didTestResult ? (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    didTestResult.result === "success" ? "default" : "destructive"
                  }
                >
                  {formatTestResultLabel(didTestResult.result)}
                </Badge>
                {didTestResult.durationMs != null ? (
                  <span className="text-xs text-muted-foreground">
                    {didTestResult.durationMs} мс
                  </span>
                ) : null}
              </div>
              {didTestResult.detail ? (
                <p className="mt-2 text-muted-foreground">{didTestResult.detail}</p>
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
        <h2 className="text-base font-semibold">Zabbix</h2>
        <p className="text-sm text-muted-foreground">
          Два графика на главной, под графиками телефонного трафика, за последние
          два часа. Пароль хранится зашифрованным и в UI не показывается. Адрес
          только https, Zabbix 6.0 или новее, учётная запись без MFA.
        </p>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="zabbix-url">Адрес</Label>
            <Input
              id="zabbix-url"
              value={zabbixApiUrl}
              onChange={(e) => setZabbixApiUrl(e.target.value)}
              placeholder="https://zabbix.example/zabbix"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zabbix-user">Логин</Label>
            <Input
              id="zabbix-user"
              value={zabbixUser}
              onChange={(e) => setZabbixUser(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zabbix-password">Пароль</Label>
            <Input
              id="zabbix-password"
              type="password"
              value={zabbixPassword}
              onChange={(e) => setZabbixPassword(e.target.value)}
              placeholder={
                settings.hasZabbixPassword
                  ? "Пароль сохранён — вставьте новый, чтобы заменить"
                  : "Пароль пользователя Zabbix"
              }
              autoComplete="new-password"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="zabbix-graph1-host">График 1, хост</Label>
              <Input
                id="zabbix-graph1-host"
                value={zabbixGraph1Host}
                onChange={(e) => setZabbixGraph1Host(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zabbix-graph1-name">График 1, название</Label>
              <Input
                id="zabbix-graph1-name"
                value={zabbixGraph1Name}
                onChange={(e) => setZabbixGraph1Name(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zabbix-graph2-host">График 2, хост</Label>
              <Input
                id="zabbix-graph2-host"
                value={zabbixGraph2Host}
                onChange={(e) => setZabbixGraph2Host(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zabbix-graph2-name">График 2, название</Label>
              <Input
                id="zabbix-graph2-name"
                value={zabbixGraph2Name}
                onChange={(e) => setZabbixGraph2Name(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={onSaveZabbix}>
              Сохранить Zabbix
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !settings.hasZabbixPassword}
              onClick={onTestZabbix}
            >
              Проверить доступ
            </Button>
          </div>
          {zabbixTestResult ? (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    zabbixTestResult.result === "success" ? "default" : "destructive"
                  }
                >
                  {formatTestResultLabel(zabbixTestResult.result)}
                </Badge>
                {zabbixTestResult.durationMs != null ? (
                  <span className="text-xs text-muted-foreground">
                    {zabbixTestResult.durationMs} мс
                  </span>
                ) : null}
              </div>
              {zabbixTestResult.detail ? (
                <p className="mt-2 text-muted-foreground">{zabbixTestResult.detail}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <SyslogSettings />

      <section className="space-y-4">
        <h2 className="text-base font-semibold">FTP — телефонный трафик</h2>
        <p className="text-sm text-muted-foreground">
          Софтсвитч — FTP-клиент на своём реальном IP, активный режим, порт
          2121 на хосте Docker (не через NPM). Шлюз SMG заливает CDR тем же
          логином на этот порт, путь на шлюзе /smg. Пароль хранится
          зашифрованным и в UI не показывается.
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
          <div className="space-y-2">
            <Label htmlFor="ftp-pasv-address">Внешний IPv4 для пассивного режима</Label>
            <Input
              id="ftp-pasv-address"
              value={ftpPasvAddress}
              onChange={(e) => setFtpPasvAddress(e.target.value)}
              placeholder="5.227.161.190"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              IPv4 Docker-хоста, тот же адрес, что у порта 2121. Нужен шлюзу SMG.
              Пустое поле выключает пассивный режим, активная выгрузка софтсвитча
              остаётся. Проверка слушателя смотрит только порт 2121.
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
