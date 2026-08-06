import { describe, expect, it } from "vitest";
import {
  AesGcmSecretEncryptionService,
  deserializeEncryptedSecret,
  serializeEncryptedSecret,
} from "@/modules/ssh/secrets";

const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("AesGcmSecretEncryptionService", () => {
  it("rejects invalid key material", () => {
    expect(() => new AesGcmSecretEncryptionService("short")).toThrow(
      /64 hex/,
    );
    expect(() => new AesGcmSecretEncryptionService("g".repeat(64))).toThrow(
      /64 hex/,
    );
  });

  it("round-trips plaintext secrets", () => {
    const svc = new AesGcmSecretEncryptionService(TEST_KEY);
    const plaintext = "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END-----";
    const enc = svc.encrypt(plaintext);
    expect(enc.iv).toBeTruthy();
    expect(enc.authTag).toBeTruthy();
    expect(enc.ciphertext).toBeTruthy();
    expect(enc.ciphertext).not.toContain("PRIVATE KEY");
    expect(svc.decrypt(enc)).toBe(plaintext);
  });

  it("produces distinct envelopes for the same plaintext", () => {
    const svc = new AesGcmSecretEncryptionService(TEST_KEY);
    const a = svc.encrypt("same");
    const b = svc.encrypt("same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails closed on tampered ciphertext", () => {
    const svc = new AesGcmSecretEncryptionService(TEST_KEY);
    const enc = svc.encrypt("secret-value");
    const tampered = {
      ...enc,
      ciphertext: Buffer.from("tampered").toString("base64"),
    };
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it("serializes and deserializes v1 envelopes", () => {
    const svc = new AesGcmSecretEncryptionService(TEST_KEY);
    const enc = svc.encrypt("payload");
    const raw = serializeEncryptedSecret(enc);
    expect(raw.startsWith("v1:")).toBe(true);
    expect(raw.split(":")).toHaveLength(4);
    expect(deserializeEncryptedSecret(raw)).toEqual(enc);
    expect(svc.decrypt(deserializeEncryptedSecret(raw))).toBe("payload");
  });

  it("rejects malformed envelopes", () => {
    expect(() => deserializeEncryptedSecret("nope")).toThrow(/Invalid encrypted/);
    expect(() => deserializeEncryptedSecret("v2:a:b:c")).toThrow(
      /Invalid encrypted/,
    );
  });
});
