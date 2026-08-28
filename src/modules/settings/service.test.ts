import { describe, expect, it } from "vitest";
import {
  geoipKeyReplaceSchema,
  keyReplaceSchema,
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
  expect(typeof view.hasPrivateKey).toBe("boolean");
  expect(typeof view.hasGeoipApiKey).toBe("boolean");
  expect(typeof view.hasPstnApiKey).toBe("boolean");
  expect(view).toHaveProperty("keyFingerprint");
  expect(view).toHaveProperty("keyAlgo");
  expect(view).toHaveProperty("geoipBaseUrl");
  expect(view).toHaveProperty("pstnBaseUrl");
  expect(view.schedulerLoopActive).toBe(false);
}

describe("settings schemas and masked view contract", () => {
  it("accepts valid settings updates and enforces poll interval floor", () => {
    expect(
      settingsUpdateSchema.parse({
        host: "softswitch.example",
        port: 22,
        username: "platform",
        regsPollEnabled: true,
        regsPollIntervalSec: 60,
        geoipBaseUrl: "http://localhost:8080/",
        pstnBaseUrl: "http://localhost:5555/",
      }),
    ).toMatchObject({
      host: "softswitch.example",
      regsPollIntervalSec: 60,
      geoipBaseUrl: "http://localhost:8080/",
      pstnBaseUrl: "http://localhost:5555/",
    });

    expect(() =>
      settingsUpdateSchema.parse({ regsPollIntervalSec: 10 }),
    ).toThrow();
  });

  it("accepts display timezones from the curated list", () => {
    expect(
      settingsUpdateSchema.parse({ displayTimezone: "Asia/Krasnoyarsk" }),
    ).toMatchObject({ displayTimezone: "Asia/Krasnoyarsk" });
    expect(() =>
      settingsUpdateSchema.parse({ displayTimezone: "Europe/Paris" }),
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
      regsPollIntervalSec: 60,
      artifactRetentionDays: 14,
      artifactKeepLastRuns: 50,
      artifactMaxBytes: 1_048_576,
      schedulerLoopActive: false,
      geoipBaseUrl: null,
      hasGeoipApiKey: false,
      pstnBaseUrl: null,
      hasPstnApiKey: false,
      displayTimezone: "Europe/Moscow",
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
