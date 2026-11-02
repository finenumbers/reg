import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import tls from "node:tls";
import { classifyTlsCodes, collectErrorCodes, tlsFailureDetail } from "@/modules/rtu-soap/ca";

const MAX_EXTRA_CA_BYTES = 256 * 1024;

export type TlsCallResult =
  | { ok: true; status: number; text: string }
  | {
      ok: false;
      code: "tls" | "timeout" | "too_large" | "network";
      detail: string;
      peerFingerprint: string | null;
      peerSubject: string | null;
    };

/**
 * One HTTPS call to the already pinned RTU origin.
 * The POST body is written only after the handshake is authorized.
 * The trust bundle is not installed on the process.
 */
export function tlsRequest(input: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  caPem: string;
  fingerprints: string[];
  timeoutMs: number;
  maxBytes: number;
}): Promise<TlsCallResult> {
  const bundle = trustBundle(input.caPem);
  if (!bundle.ok) {
    return Promise.resolve(fail("tls", bundle.detail));
  }
  const pins = new Set(input.fingerprints.map((item) => item.toUpperCase()));
  let target: URL;
  try {
    target = new URL(input.url);
  } catch {
    return Promise.resolve(fail("network", "Нет соединения с коммутатором."));
  }

  return new Promise((resolve) => {
    let settled = false;
    let peerFingerprint: string | null = null;
    let peerSubject: string | null = null;
    let wrote = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: TlsCallResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    const capturePeer = (socket: tls.TLSSocket | undefined) => {
      if (!socket || typeof socket.getPeerCertificate !== "function") return;
      try {
        const peer = socket.getPeerCertificate(false);
        if (!peer || Object.keys(peer).length === 0) return;
        if (typeof peer.fingerprint256 === "string") peerFingerprint = peer.fingerprint256;
        peerSubject = formatSubject(peer.subject);
      } catch {
        // The peer certificate is optional diagnostic data.
      }
    };

    const failFromError = (error: unknown) => {
      if (timedOut) {
        finish(fail("timeout", "Коммутатор не ответил вовремя."));
        return;
      }
      const kind = classifyTlsCodes(collectErrorCodes(error));
      if (kind) {
        finish(fail("tls", tlsFailureDetail(kind), peerFingerprint, peerSubject));
        return;
      }
      finish(fail("network", "Нет соединения с коммутатором.", peerFingerprint, peerSubject));
    };

    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: input.method,
        headers: { ...input.headers, Connection: "close" },
        agent: false,
        ca: bundle.ca,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        checkServerIdentity(host, cert) {
          if (typeof cert.fingerprint256 === "string") peerFingerprint = cert.fingerprint256;
          peerSubject = formatSubject(cert.subject);
          const leaf = cert.fingerprint256?.toUpperCase();
          if (leaf && pins.has(leaf)) return undefined;
          return tls.checkServerIdentity(host, cert);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > input.maxBytes) {
            res.destroy();
            finish(fail("too_large", "Ответ больше допустимого размера."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          finish({
            ok: true,
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", failFromError);
      },
    );

    timer = setTimeout(() => {
      timedOut = true;
      req.destroy();
    }, input.timeoutMs);

    req.on("socket", (socket) => {
      const tlsSocket = socket as tls.TLSSocket;
      tlsSocket.once("secureConnect", () => {
        capturePeer(tlsSocket);
        if (!tlsSocket.authorized) {
          const code = authorizationCode(tlsSocket.authorizationError);
          const error = new Error("tls") as Error & { code: string };
          error.code = code || "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
          req.destroy(error);
          return;
        }
        if (wrote) return;
        wrote = true;
        if (input.body) req.write(input.body);
        req.end();
      });
    });
    req.on("error", (error) => {
      capturePeer(req.socket as tls.TLSSocket | undefined);
      failFromError(error);
    });
  });
}

function trustBundle(
  caPem: string,
): { ok: true; ca: string[] } | { ok: false; detail: string } {
  const ca = [...tls.rootCertificates, caPem];
  const extraPath = process.env.NODE_EXTRA_CA_CERTS?.trim();
  if (!extraPath) return { ok: true, ca };
  if (!path.isAbsolute(extraPath)) {
    return { ok: false, detail: "NODE_EXTRA_CA_CERTS не прочитан." };
  }
  try {
    const stat = fs.statSync(extraPath);
    if (!stat.isFile() || stat.size > MAX_EXTRA_CA_BYTES) {
      return { ok: false, detail: "NODE_EXTRA_CA_CERTS не прочитан." };
    }
    ca.push(fs.readFileSync(extraPath, "utf8"));
  } catch {
    return { ok: false, detail: "NODE_EXTRA_CA_CERTS не прочитан." };
  }
  return { ok: true, ca };
}

function authorizationCode(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "code" in value) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

function formatSubject(subject: tls.PeerCertificate["subject"] | undefined): string | null {
  if (!subject) return null;
  const parts = Object.entries(subject)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([key, value]) => `${key}=${value}`);
  if (parts.length === 0) return null;
  return parts.join(", ").slice(0, 200);
}

function fail(
  code: "tls" | "timeout" | "too_large" | "network",
  detail: string,
  peerFingerprint: string | null = null,
  peerSubject: string | null = null,
): TlsCallResult {
  return { ok: false, code, detail, peerFingerprint, peerSubject };
}
