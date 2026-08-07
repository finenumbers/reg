/**
 * AES-256-GCM secret encryption for SSH private keys at rest.
 *
 * Envelope format stored in DB: `v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>`
 * Master key: `APP_ENCRYPTION_KEY` (64 hex chars = 32 bytes) from env.
 *
 * Never log plaintext or decrypted key material.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getServerEnv } from "@/lib/env";

export type EncryptedSecret = {
  /** Base64 ciphertext (AES-256-GCM) */
  ciphertext: string;
  /** Base64 IV (12 bytes) */
  iv: string;
  /** Base64 auth tag (16 bytes) */
  authTag: string;
};

export interface SecretEncryptionService {
  encrypt(plaintext: string): EncryptedSecret;
  decrypt(secret: EncryptedSecret): string;
}

const HEX_64 = /^[0-9a-fA-F]{64}$/;

export class AesGcmSecretEncryptionService implements SecretEncryptionService {
  private readonly key: Buffer;

  constructor(keyHex: string) {
    if (!HEX_64.test(keyHex)) {
      throw new Error("APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
    }
    this.key = Buffer.from(keyHex, "hex");
  }

  encrypt(plaintext: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    };
  }

  decrypt(secret: EncryptedSecret): string {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(secret.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}

/**
 * Serialize EncryptedSecret for DB storage (single string column).
 * Format: v1:<iv>:<authTag>:<ciphertext> (all base64 parts).
 */
export function serializeEncryptedSecret(secret: EncryptedSecret): string {
  return `v1:${secret.iv}:${secret.authTag}:${secret.ciphertext}`;
}

export function deserializeEncryptedSecret(raw: string): EncryptedSecret {
  const parts = raw.split(":");
  if (parts.length !== 4) {
    throw new Error("Invalid encrypted secret envelope");
  }
  const [version, iv, authTag, ciphertext] = parts;
  if (version !== "v1" || !iv || !authTag || !ciphertext) {
    throw new Error("Invalid encrypted secret envelope");
  }
  return { iv, authTag, ciphertext };
}

let cachedEncryption: AesGcmSecretEncryptionService | null = null;

/** App-wide encryption service bound to APP_ENCRYPTION_KEY. */
export function getSecretEncryptionService(): SecretEncryptionService {
  if (!cachedEncryption) {
    cachedEncryption = new AesGcmSecretEncryptionService(
      getServerEnv().APP_ENCRYPTION_KEY,
    );
  }
  return cachedEncryption;
}
