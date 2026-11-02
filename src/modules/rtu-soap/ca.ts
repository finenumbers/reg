import { X509Certificate } from "node:crypto";

const MAX_PEM_CHARS = 32_768;
const MAX_CERTS = 8;
const SUBJECT_CHARS = 200;

export type RtuCaCert = {
  fingerprint256: string;
  subject: string;
};

export type ParsedRtuCa = {
  pem: string;
  certs: RtuCaCert[];
};

export type PemParseFailure = "empty" | "private_key" | "invalid" | "too_many";

const BLOCK_RE = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g;

export function parseRtuCaPem(
  input: string,
): { ok: true; ca: ParsedRtuCa } | { ok: false; reason: PemParseFailure } {
  const text = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (text.length > MAX_PEM_CHARS) return { ok: false, reason: "invalid" };

  const blocks: string[] = [];
  const re = new RegExp(BLOCK_RE.source, "g");
  let match: RegExpExecArray | null;
  let last = 0;
  while ((match = re.exec(text))) {
    if (text.slice(last, match.index).trim().length > 0) {
      return { ok: false, reason: "invalid" };
    }
    const label = match[1] ?? "";
    if (label !== "CERTIFICATE") {
      if (label.includes("PRIVATE KEY")) return { ok: false, reason: "private_key" };
      return { ok: false, reason: "invalid" };
    }
    blocks.push(match[0].trim());
    last = match.index + match[0].length;
  }
  if (text.slice(last).trim().length > 0) return { ok: false, reason: "invalid" };
  if (blocks.length === 0) return { ok: false, reason: "invalid" };
  if (blocks.length > MAX_CERTS) return { ok: false, reason: "too_many" };

  const certs: RtuCaCert[] = [];
  const normalized: string[] = [];
  for (const block of blocks) {
    const pem = block.endsWith("\n") ? block : `${block}\n`;
    try {
      const certificate = new X509Certificate(pem);
      certs.push({
        fingerprint256: certificate.fingerprint256,
        subject: certificate.subject.slice(0, SUBJECT_CHARS),
      });
    } catch {
      return { ok: false, reason: "invalid" };
    }
    normalized.push(pem);
  }
  return { ok: true, ca: { pem: normalized.join(""), certs } };
}

export function rtuCaPemMessage(reason: PemParseFailure): string {
  if (reason === "empty") return "Пустой сертификат";
  if (reason === "private_key") return "Вставьте сертификат, не закрытый ключ";
  if (reason === "too_many") return "Слишком много сертификатов";
  return "Нужен PEM: блоки BEGIN CERTIFICATE";
}

/** Empty string clears the stored PEM. A missing field must not call this. */
export function rtuCaPemForStore(value: string): string | null {
  if (value.length === 0) return null;
  const parsed = parseRtuCaPem(value);
  if (!parsed.ok) {
    throw new Error(rtuCaPemMessage(parsed.reason));
  }
  return parsed.ca.pem;
}

export function describeRtuCa(pem: string | null | undefined): {
  hasRtuSoapCa: boolean;
  rtuSoapCaCerts: RtuCaCert[];
} {
  if (!pem) return { hasRtuSoapCa: false, rtuSoapCaCerts: [] };
  const parsed = parseRtuCaPem(pem);
  if (!parsed.ok) return { hasRtuSoapCa: true, rtuSoapCaCerts: [] };
  return { hasRtuSoapCa: true, rtuSoapCaCerts: parsed.ca.certs };
}

export type TlsFailureKind = "issuer" | "name" | "expired" | "other";

const NAME_CODE = /ERR_TLS_CERT_ALTNAME_INVALID|HOSTNAME_MISMATCH/i;
const EXPIRED_CODE = /CERT_HAS_EXPIRED|CERT_NOT_YET_VALID/i;
const ISSUER_CODE =
  /UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED_CERT_IN_CHAIN|CERT_UNTRUSTED/i;
const OTHER_TLS_CODE = /^(ERR_TLS|ERR_SSL)|CERT_|SSL_/i;

export function collectErrorCodes(error: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes;
}

/** Name, then expiry, then the issuer. A bare ERR_TLS code is not an unknown CA. */
export function classifyTlsCodes(codes: string[]): TlsFailureKind | null {
  let expired = false;
  let issuer = false;
  let other = false;
  for (const code of codes) {
    if (NAME_CODE.test(code)) return "name";
    if (EXPIRED_CODE.test(code)) expired = true;
    else if (ISSUER_CODE.test(code)) issuer = true;
    else if (OTHER_TLS_CODE.test(code)) other = true;
  }
  if (expired) return "expired";
  if (issuer) return "issuer";
  if (other) return "other";
  return null;
}

export function tlsFailureDetail(kind: TlsFailureKind): string {
  if (kind === "issuer") {
    return "Издатель сертификата не в списке доверенных. Вставьте PEM сертификата коммутатора или его CA.";
  }
  if (kind === "name") return "Имя в сертификате не совпадает с URL.";
  if (kind === "expired") return "Срок сертификата недействителен.";
  return "Соединение TLS оборвалось.";
}
