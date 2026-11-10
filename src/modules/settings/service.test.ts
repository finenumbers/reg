import { describe, expect, it } from "vitest";
import {
  geoipKeyReplaceSchema,
  keyReplaceSchema,
  didKeyReplaceSchema,
  pstnKeyReplaceSchema,
  settingsUpdateSchema,
  type SettingsView,
} from "@/modules/settings/schemas";

/**
 * Masked SettingsView contract — API must never include ciphertext / PEM.
 */
function assertMaskedSettings(view: SettingsView) {
  const json = JSON.stringify(view);
  expect(json).not.toMatch(/PRIVATE KEY/i);
  expect(json).not.toMatch(/privateKeyCiphertext/i);
  expect(json).not.toMatch(/passphrase/i);
  expect(json).not.toMatch(/geoipApiKeyCiphertext/i);
  expect(json).not.toMatch(/pstnApiKeyCiphertext/i);
  expect(json).not.toMatch(/didApiTokenCiphertext/i);
  expect(json).not.toMatch(/"apiToken"/i);
  expect(json).not.toMatch(/ftpPasswordCiphertext/i);
  expect(json).not.toMatch(/smgFtp/i);
  expect(json).not.toMatch(/voipmonitorPasswordCiphertext/i);
  expect(json).not.toMatch(/rtuSoapPasswordCiphertext/i);
  expect(json).not.toMatch(/zabbixPasswordCiphertext/i);
  expect(typeof view.hasVoipmonitorPassword).toBe("boolean");
  expect(typeof view.hasRtuSoapPassword).toBe("boolean");
  expect(typeof view.hasZabbixPassword).toBe("boolean");
  expect(typeof view.hasRtuSoapCa).toBe("boolean");
  expect(json).not.toMatch(/rtuSoapCaPem/i);
  expect(json).not.toMatch(/BEGIN CERTIFICATE/i);
  expect(typeof view.hasPrivateKey).toBe("boolean");
  expect(typeof view.hasGeoipApiKey).toBe("boolean");
  expect(typeof view.hasPstnApiKey).toBe("boolean");
  expect(typeof view.hasDidApiToken).toBe("boolean");
  expect(typeof view.hasFtpPassword).toBe("boolean");
  expect(view).toHaveProperty("keyFingerprint");
  expect(view).toHaveProperty("keyAlgo");
  expect(view).toHaveProperty("geoipBaseUrl");
  expect(view).toHaveProperty("pstnBaseUrl");
  expect(view).toHaveProperty("didBaseUrl");
  expect(view.schedulerLoopActive).toBe(false);
}

describe("settings schemas and masked view contract", () => {
  it("accepts valid settings updates and ignores fixed poll intervals", () => {
    expect(
      settingsUpdateSchema.parse({
        host: "softswitch.example",
        port: 22,
        username: "platform",
        regsPollEnabled: true,
        regsPollIntervalSec: 60,
        exportSyncEnabled: true,
        exportSyncIntervalSec: 300,
        geoipBaseUrl: "http://localhost:8080/",
        pstnBaseUrl: "http://localhost:5555/",
      }),
    ).toMatchObject({
      host: "softswitch.example",
      regsPollEnabled: true,
      geoipBaseUrl: "http://localhost:8080/",
      pstnBaseUrl: "http://localhost:5555/",
    });
    expect(
      settingsUpdateSchema.parse({
        regsPollIntervalSec: 10,
        exportSyncIntervalSec: 10,
      }),
    ).toEqual({});
    expect(() =>
      settingsUpdateSchema.parse({ cdrSidesRefreshIntervalSec: 10 }),
    ).toThrow();
    expect(() =>
      settingsUpdateSchema.parse({ numberGeographyRefreshIntervalSec: 10 }),
    ).toThrow();
    expect(
      settingsUpdateSchema.parse({
        numberGeographyRefreshEnabled: false,
        numberGeographyRefreshIntervalSec: 60,
      }),
    ).toMatchObject({
      numberGeographyRefreshEnabled: false,
      numberGeographyRefreshIntervalSec: 60,
    });
  });

  it("accepts display timezones from the curated list", () => {
    expect(
      settingsUpdateSchema.parse({ displayTimezone: "Asia/Novosibirsk" }),
    ).toMatchObject({ displayTimezone: "Asia/Novosibirsk" });
    expect(
      settingsUpdateSchema.parse({ displayTimezone: "Asia/Krasnoyarsk" }),
    ).toMatchObject({ displayTimezone: "Asia/Krasnoyarsk" });
    expect(() =>
      settingsUpdateSchema.parse({ displayTimezone: "Europe/Paris" }),
    ).toThrow();
  });

  it("accepts an empty passive address and a dotted IPv4 only", () => {
    expect(settingsUpdateSchema.parse({ ftpPasvAddress: "" })).toMatchObject({
      ftpPasvAddress: "",
    });
    expect(
      settingsUpdateSchema.parse({ ftpPasvAddress: "5.227.161.190" }),
    ).toMatchObject({ ftpPasvAddress: "5.227.161.190" });
    expect(() =>
      settingsUpdateSchema.parse({ ftpPasvAddress: "reg.finenumbers.com" }),
    ).toThrow();
    expect(() =>
      settingsUpdateSchema.parse({ ftpPasvAddress: "ftp://5.227.161.190" }),
    ).toThrow();
  });

  it("allows empty GeoIP URL (server stores the default origin)", () => {
    expect(settingsUpdateSchema.parse({ geoipBaseUrl: "" })).toMatchObject({
      geoipBaseUrl: "",
    });
  });

  it("rejects empty host/username when provided", () => {
    expect(() => settingsUpdateSchema.parse({ host: "" })).toThrow();
    expect(() => settingsUpdateSchema.parse({ username: "" })).toThrow();
  });

  it("requires key material for replace", () => {
    expect(() => keyReplaceSchema.parse({ rawKeyMaterial: "" })).toThrow();
    expect(
      keyReplaceSchema.parse({
        rawKeyMaterial: "-----BEGIN OPENSSH PRIVATE KEY-----\n",
        passphrase: "x",
      }),
    ).toMatchObject({ passphrase: "x" });
  });

  it("requires a non-empty PSTN API key for replace", () => {
    expect(() => pstnKeyReplaceSchema.parse({ apiKey: "" })).toThrow();
    expect(pstnKeyReplaceSchema.parse({ apiKey: "pstn-secret" })).toEqual({
      apiKey: "pstn-secret",
    });
  });

  it("requires a non-empty DID token and rejects a URL with credentials", () => {
    expect(() => didKeyReplaceSchema.parse({ apiKey: "" })).toThrow();
    expect(didKeyReplaceSchema.parse({ apiKey: "did-token" })).toEqual({
      apiKey: "did-token",
    });
    expect(
      settingsUpdateSchema.parse({ didBaseUrl: "http://did-frontend:3000/free-numbers" }),
    ).toMatchObject({ didBaseUrl: "http://did-frontend:3000/free-numbers" });
    expect(settingsUpdateSchema.parse({ didBaseUrl: "" })).toMatchObject({
      didBaseUrl: "",
    });
    expect(() =>
      settingsUpdateSchema.parse({ didBaseUrl: "http://user:secret@did-frontend:3000" }),
    ).toThrow();
    expect(settingsUpdateSchema.parse({ rtuSoapBaseUrl: "https://rtu.example" })).toMatchObject({
      rtuSoapBaseUrl: "https://rtu.example",
    });
    expect(settingsUpdateSchema.parse({ rtuSoapBaseUrl: "" })).toMatchObject({
      rtuSoapBaseUrl: "",
    });
    expect(() =>
      settingsUpdateSchema.parse({ rtuSoapBaseUrl: "http://rtu.example" }),
    ).toThrow();
    expect(() =>
      settingsUpdateSchema.parse({ rtuSoapBaseUrl: "https://user:pw@rtu.example" }),
    ).toThrow();
    expect(() =>
      settingsUpdateSchema.parse({ rtuSoapBaseUrl: "https://rtu.example/service" }),
    ).toThrow();
    expect(settingsUpdateSchema.parse({ rtuSoapLogin: "ops" })).not.toHaveProperty(
      "rtuSoapCaPem",
    );
    expect(settingsUpdateSchema.parse({ rtuSoapCaPem: "" })).toMatchObject({
      rtuSoapCaPem: "",
    });
    expect(() => settingsUpdateSchema.parse({ rtuSoapCaPem: "   " })).toThrow();
    expect(() =>
      settingsUpdateSchema.parse({
        rtuSoapCaPem: "-----BEGIN PRIVATE KEY-----\nA\n-----END PRIVATE KEY-----",
      }),
    ).toThrow();
  });

  it("accepts a Zabbix https address and a complete graph slot", () => {
    expect(
      settingsUpdateSchema.parse({
        zabbixApiUrl: "https://zabbix.example/zabbix",
        zabbixUser: "ops",
        zabbixGraph1Host: "gw",
        zabbixGraph1Name: "SIP",
        zabbixGraph2Host: "",
        zabbixGraph2Name: "",
      }),
    ).toMatchObject({
      zabbixApiUrl: "https://zabbix.example/zabbix",
      zabbixGraph1Name: "SIP",
    });
    expect(() => settingsUpdateSchema.parse({ zabbixApiUrl: "http://zabbix.example" })).toThrow();
    expect(() =>
      settingsUpdateSchema.parse({ zabbixApiUrl: "https://user:pw@zabbix.example" }),
    ).toThrow();
    expect(() =>
      settingsUpdateSchema.parse({ zabbixGraph1Host: "gw", zabbixGraph1Name: "" }),
    ).toThrow();
    expect(settingsUpdateSchema.parse({})).toEqual({});
  });

  it("requires a non-empty GeoIP API key for replace", () => {
    expect(() => geoipKeyReplaceSchema.parse({ apiKey: "" })).toThrow();
    expect(geoipKeyReplaceSchema.parse({ apiKey: "geoip-secret" })).toEqual({
      apiKey: "geoip-secret",
    });
  });

  it("masked settings view never exposes secrets", () => {
    const view: SettingsView = {
      host: "10.0.0.1",
      port: 22,
      username: "platform",
      profileId: "prof_1",
      hasPrivateKey: true,
      keyFingerprint: "SHA256:abc",
      keyAlgo: "ed25519",
      regsPollEnabled: false,
      regsPollIntervalSec: 30,
      exportSyncEnabled: false,
      exportSyncIntervalSec: 60,
      cdrSidesRefreshEnabled: true,
      cdrSidesRefreshIntervalSec: 300,
      numberGeographyRefreshEnabled: true,
      numberGeographyRefreshIntervalSec: 60,
      artifactRetentionDays: 14,
      artifactKeepLastRuns: 50,
      artifactMaxBytes: 1_048_576,
      schedulerLoopActive: false,
      geoipBaseUrl: null,
      hasGeoipApiKey: false,
      pstnBaseUrl: null,
      hasPstnApiKey: false,
      didBaseUrl: null,
      hasDidApiToken: false,
      displayTimezone: "Europe/Moscow",
      ftpEnabled: false,
      ftpUsername: null,
      hasFtpPassword: false,
      ftpListenPort: 2121,
      ftpPasvMinPort: 50100,
      ftpPasvMaxPort: 50109,
      ftpPasvAddress: null,
      ftpListenerActive: false,
      voipmonitorEnabled: false,
      voipmonitorApiUrl: null,
      voipmonitorUser: null,
      hasVoipmonitorPassword: false,
      voipmonitorGuiUrl: null,
      rtuSoapBaseUrl: null,
      rtuSoapLogin: null,
      hasRtuSoapPassword: false,
      hasRtuSoapCa: false,
      rtuSoapCaCerts: [],
      zabbixApiUrl: null,
      zabbixUser: null,
      hasZabbixPassword: false,
      zabbixGraph1Host: null,
      zabbixGraph1Name: null,
      zabbixGraph2Host: null,
      zabbixGraph2Name: null,
    };
    assertMaskedSettings(view);
  });
});

describe("SSH connection test authorization mapping", () => {
  function mapPermission(granted: string[], required: "ssh:test" | "settings:write") {
    if (!granted.includes(required)) return 403;
    return 200;
  }

  it("allows operator ssh:test without settings:write", () => {
    const operator = ["regs:read", "regs:poll", "ssh:test"];
    expect(mapPermission(operator, "ssh:test")).toBe(200);
    expect(mapPermission(operator, "settings:write")).toBe(403);
  });

  it("allows admin both settings write and ssh test", () => {
    const admin = [
      "settings:write",
      "ssh:test",
      "regs:read",
      "regs:poll",
      "audit:read",
      "users:admin",
    ];
    expect(mapPermission(admin, "ssh:test")).toBe(200);
    expect(mapPermission(admin, "settings:write")).toBe(200);
  });
});

describe("connection test result mapping", () => {
  function toHttpStatus(result: "success" | "auth_error" | "timeout" | "error") {
    return result === "success" ? 200 : 502;
  }

  it("maps success to 200 and failures to 502", () => {
    expect(toHttpStatus("success")).toBe(200);
    expect(toHttpStatus("auth_error")).toBe(502);
    expect(toHttpStatus("timeout")).toBe(502);
    expect(toHttpStatus("error")).toBe(502);
  });
});
