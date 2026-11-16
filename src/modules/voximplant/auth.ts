/**
 * Service-account JSON and the RS256 token.
 * `iss` is the account id as a JSON number. The key never leaves this module except as a Bearer header.
 */

import { createPrivateKey, sign, type KeyObject } from "node:crypto";

export const CREDENTIALS_UNREAD = "Проверьте ключ.";

const MAX_CREDENTIALS = 100_000;
const JWT_TTL_SECONDS = 3600;
const IAT_SKEW_SECONDS = 10;
const REFRESH_SKEW_SECONDS = 60;
const KEY_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type VoximplantCredentials = {
  accountId: number;
  keyId: string;
  privateKeyPem: string;
  blob: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function privateKey(pem: string): KeyObject | null {
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "rsa") return null;
    return key;
  } catch {
    return null;
  }
}

/** The whole credentials JSON, or null when it cannot sign. Extra fields stay in `blob`. */
export function parseCredentials(text: string): VoximplantCredentials | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_CREDENTIALS) return null;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const accountId = data.account_id;
  const keyId = data.key_id;
  const rawKey = data.private_key;
  if (
    typeof accountId !== "number" ||
    !Number.isSafeInteger(accountId) ||
    accountId <= 0
  ) {
    return null;
  }
  if (typeof keyId !== "string" || !KEY_ID.test(keyId)) return null;
  if (typeof rawKey !== "string" || rawKey.length === 0 || rawKey.length > 20_000)
    return null;
  const pem = rawKey.includes("\\n") ? rawKey.replaceAll("\\n", "\n") : rawKey;
  if (!pem.includes("BEGIN") || !pem.includes("PRIVATE KEY")) return null;
  if (!privateKey(pem)) return null;
  return { accountId, keyId, privateKeyPem: pem, blob: trimmed };
}

function b64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/** Header `typ` JWT, `alg` RS256, `kid`. Payload `iat` is ten seconds behind `nowSeconds`. */
export function signJwt(creds: VoximplantCredentials, nowSeconds: number): string {
  const iat = nowSeconds - IAT_SKEW_SECONDS;
  const header = { typ: "JWT", alg: "RS256", kid: creds.keyId };
  const payload = { iat, iss: creds.accountId, exp: iat + JWT_TTL_SECONDS };
  const body = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = sign("RSA-SHA256", Buffer.from(body), creds.privateKeyPem);
  return `${body}.${b64url(signature)}`;
}

export class TokenCache {
  private token = "";
  private exp = 0;

  sign(creds: VoximplantCredentials, nowSeconds: number): string {
    if (this.token && nowSeconds < this.exp - REFRESH_SKEW_SECONDS) return this.token;
    const iat = nowSeconds - IAT_SKEW_SECONDS;
    this.token = signJwt(creds, nowSeconds);
    this.exp = iat + JWT_TTL_SECONDS;
    return this.token;
  }
}
