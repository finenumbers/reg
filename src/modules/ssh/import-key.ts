/**
 * Private key import / normalize pipeline.
 *
 * Supports:
 * - PuTTYgen .ppk (v2 and v3, incl. passphrase-protected) via `ppk-to-openssh`
 * - PEM / OpenSSH private keys via `sshpk`
 *
 * Pipeline: detect → decrypt in memory (if needed) → normalize to OpenSSH private
 * key → validate loadability → fingerprint → caller encrypts at rest.
 *
 * Passphrase is used only during import and is never persisted.
 *
 * Library choice for .ppk: `ppk-to-openssh` (GPL-3.0). `sshpk` alone cannot decrypt
 * encrypted PPK v3 (Argon2), which is PuTTYgen's modern default. Tradeoff documented
 * in docs/security-model.md.
 *
 * Important: do NOT use `parseFromString` for PPK — it forces `outputFormat: "openssh"`,
 * and that writer is broken for RSA/ECDSA. Use `PPKParser({ outputFormat: "pem" })` instead.
 */

import sshpk from "sshpk";
import { PPKParser, PPKError } from "ppk-to-openssh";
import { KeyImportError } from "@/modules/ssh/errors";
import { logger } from "@/lib/logger";

/** Hard limit for uploaded key material (64 KiB). */
export const MAX_KEY_MATERIAL_BYTES = 64 * 1024;

export type DetectedKeyFormat = "ppk" | "pem" | "openssh" | "unknown";

export type ImportedPrivateKey = {
  /** Normalized OpenSSH private key (plaintext, in-memory only) */
  normalizedPem: string;
  fingerprintSha256: string;
  algorithm: string;
  sourceFormat: DetectedKeyFormat;
};

export type KeyImportInput = {
  /** Raw upload bytes/text (.ppk or PEM/OpenSSH) */
  rawKeyMaterial: string;
  /** Passphrase for encrypted PPK/PEM — discarded after import */
  passphrase?: string;
};

export interface PrivateKeyImportService {
  importKey(input: KeyImportInput): Promise<ImportedPrivateKey>;
}

export function detectKeyFormat(raw: string): DetectedKeyFormat {
  const trimmed = raw.trim();
  if (/^PuTTY-User-Key-File-[23]:/im.test(trimmed)) return "ppk";
  if (/^-----BEGIN OPENSSH PRIVATE KEY-----/m.test(trimmed)) return "openssh";
  if (
    /^-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/m.test(trimmed) ||
    /^-----BEGIN ENCRYPTED PRIVATE KEY-----/m.test(trimmed)
  ) {
    return "pem";
  }
  return "unknown";
}

/** Read algorithm from PPK header only (no private material). */
export function peekPpkAlgorithm(raw: string): string | null {
  const match = raw.trim().match(/^PuTTY-User-Key-File-[23]:\s*(\S+)/im);
  return match?.[1] ?? null;
}

function assertSize(raw: string): void {
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes === 0) {
    throw new KeyImportError("KEY_EMPTY", "Key material is empty");
  }
  if (bytes > MAX_KEY_MATERIAL_BYTES) {
    throw new KeyImportError(
      "KEY_TOO_LARGE",
      `Key material exceeds ${MAX_KEY_MATERIAL_BYTES} bytes`,
    );
  }
}

function mapSshpkError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("incorrect passphrase") ||
    lower.includes("bad decrypt") ||
    lower.includes("mac check")
  ) {
    throw new KeyImportError(
      "WRONG_PASSPHRASE",
      "Неверный passphrase для private key",
    );
  }
  if (
    lower.includes("encrypted") ||
    lower.includes("passphrase required") ||
    lower.includes("key is encrypted")
  ) {
    throw new KeyImportError(
      "PASSPHRASE_REQUIRED",
      "Для расшифровки этого private key нужен passphrase",
    );
  }
  throw new KeyImportError(
    "INVALID_KEY",
    "Некорректный или неподдерживаемый private key",
  );
}

function mapPpkError(error: unknown): never {
  if (error instanceof KeyImportError) throw error;

  if (error instanceof PPKError) {
    const code = String(error.code ?? "").toUpperCase();
    const msg = (error.message ?? "").toLowerCase();
    const hint = String(error.details?.hint ?? "").toLowerCase();
    const combined = `${msg} ${hint} ${code}`;

    if (
      combined.includes("PASSPHRASE") &&
      (combined.includes("REQUIRED") ||
        combined.includes("MISSING") ||
        combined.includes("NEED"))
    ) {
      throw new KeyImportError(
        "PASSPHRASE_REQUIRED",
        "Для расшифровки этого ключа PuTTYgen (.ppk) нужен passphrase",
      );
    }
    if (
      combined.includes("WRONG") ||
      combined.includes("INCORRECT") ||
      combined.includes("INVALID_PASSPHRASE") ||
      combined.includes("MAC") ||
      combined.includes("DECRYPT")
    ) {
      throw new KeyImportError(
        "WRONG_PASSPHRASE",
        "Неверный passphrase для ключа PuTTYgen (.ppk)",
      );
    }
    if (combined.includes("UNSUPPORTED") || combined.includes("UNKNOWN")) {
      throw new KeyImportError(
        "UNSUPPORTED_FORMAT",
        "Неподдерживаемый тип или версия ключа PuTTYgen (.ppk)",
      );
    }
    throw new KeyImportError(
      "INVALID_KEY",
      "Некорректный или повреждённый ключ PuTTYgen (.ppk)",
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("passphrase") && lower.includes("required")) {
    throw new KeyImportError(
      "PASSPHRASE_REQUIRED",
      "Для расшифровки этого ключа PuTTYgen (.ppk) нужен passphrase",
    );
  }
  if (
    lower.includes("incorrect") ||
    lower.includes("wrong") ||
    lower.includes("mac")
  ) {
    throw new KeyImportError(
      "WRONG_PASSPHRASE",
      "Неверный passphrase для ключа PuTTYgen (.ppk)",
    );
  }
  throw new KeyImportError(
    "INVALID_KEY",
    "Некорректный или повреждённый ключ PuTTYgen (.ppk)",
  );
}

function normalizeAndFingerprint(
  privateKeyText: string,
  context?: { source: "ppk" | "pem" | "openssh"; ppkAlgorithm?: string | null },
): {
  normalizedPem: string;
  fingerprintSha256: string;
  algorithm: string;
} {
  let key: sshpk.PrivateKey;
  try {
    key = sshpk.parsePrivateKey(privateKeyText, "auto");
  } catch (error) {
    if (context?.source === "ppk") {
      logger.warn("ssh.import.ppk_normalize_failed", {
        ppkAlgorithm: context.ppkAlgorithm ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new KeyImportError(
        "INVALID_KEY",
        "PPK расшифрован, но нормализация ключа не удалась — проверьте тип ключа или переэкспортируйте из PuTTYgen",
      );
    }
    mapSshpkError(error);
  }

  // Prefer modern OpenSSH private key format as internal storage form.
  let normalizedPem: string;
  try {
    normalizedPem = key.toString("openssh");
  } catch {
    normalizedPem = key.toString("pem");
  }

  // Re-parse normalized form to ensure loadability for ssh2.
  try {
    sshpk.parsePrivateKey(normalizedPem, "auto");
  } catch {
    throw new KeyImportError(
      "INVALID_KEY",
      "Нормализованный ключ не прошёл проверку загрузки",
    );
  }

  const pub = key.toPublic();
  const fingerprintSha256 = pub.fingerprint("sha256").toString();
  const algorithm = key.type; // e.g. rsa, ed25519, ecdsa

  return { normalizedPem, fingerprintSha256, algorithm };
}

async function importPpk(
  raw: string,
  passphrase?: string,
): Promise<ImportedPrivateKey> {
  const ppkAlgorithm = peekPpkAlgorithm(raw);
  let result: { privateKey: string };
  try {
    // PEM output is required: parseFromString forces broken OpenSSH for RSA/ECDSA.
    // Runtime accepts outputFormat even if published typings omit it.
    const parser = new PPKParser({
      outputFormat: "pem",
    } as never);
    result = await parser.parse(raw, passphrase ?? "");
  } catch (error) {
    mapPpkError(error);
  }

  const normalized = normalizeAndFingerprint(result.privateKey, {
    source: "ppk",
    ppkAlgorithm,
  });
  return {
    ...normalized,
    sourceFormat: "ppk",
  };
}

function importPemOrOpenssh(
  raw: string,
  format: "pem" | "openssh",
  passphrase?: string,
): ImportedPrivateKey {
  let key: sshpk.PrivateKey;
  try {
    key = sshpk.parsePrivateKey(raw, "auto", {
      passphrase: passphrase || undefined,
    });
  } catch (error) {
    mapSshpkError(error);
  }

  let normalizedPem: string;
  try {
    normalizedPem = key.toString("openssh");
  } catch {
    normalizedPem = key.toString("pem");
  }

  try {
    sshpk.parsePrivateKey(normalizedPem, "auto");
  } catch {
    throw new KeyImportError(
      "INVALID_KEY",
      "Нормализованный ключ не прошёл проверку загрузки",
    );
  }

  const fingerprintSha256 = key.toPublic().fingerprint("sha256").toString();
  return {
    normalizedPem,
    fingerprintSha256,
    algorithm: key.type,
    sourceFormat: format,
  };
}

export class DefaultPrivateKeyImportService implements PrivateKeyImportService {
  async importKey(input: KeyImportInput): Promise<ImportedPrivateKey> {
    assertSize(input.rawKeyMaterial);
    const format = detectKeyFormat(input.rawKeyMaterial);

    if (format === "unknown") {
      throw new KeyImportError(
        "UNSUPPORTED_FORMAT",
        "Неподдерживаемый формат ключа — ожидается PuTTYgen .ppk или PEM/OpenSSH private key",
      );
    }

    if (format === "ppk") {
      return importPpk(input.rawKeyMaterial, input.passphrase);
    }

    return importPemOrOpenssh(input.rawKeyMaterial, format, input.passphrase);
  }
}

export const privateKeyImportService: PrivateKeyImportService =
  new DefaultPrivateKeyImportService();
