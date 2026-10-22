import { radiusReleaseLine } from "@/modules/smg-trace/assemble";
import { classifyAntifraud } from "@/modules/smg-trace/classify";
import type { TraceBlocks } from "@/modules/smg-trace/types";

/** Names the operator uses. An unknown address is shown as the address alone. */
const SERVER_NAMES: Record<string, string> = {
  "91.195.253.131": "Dev Callhose",
  "91.195.252.131": "Prod Callhose",
  "5.227.161.183": "Parking",
};

export type ServerRow = {
  name: string;
  ip: string;
  outcome: string;
  requestId: number;
  /** 1-based count of `is sent` for this Request ID. */
  attempt: number;
  /** Printed only when this Request ID was sent more than once. */
  showAttempt: boolean;
};

export type ExchangeSummary = {
  category: string;
  status: string;
  servers: ServerRow[];
};

type Verdict = "none" | "accept" | "reject";

type Attempt = {
  id: number;
  attempt: number;
  ip: string;
  ms: number | null;
  verdict: Verdict;
  exhausted: boolean;
  /** A timeout, or the next send of this same Request ID, closed this send without a reply. */
  closed: boolean;
  released: boolean;
};

/**
 * Result and status come from the same classifier as the sheet.
 * Server rows name the address only. The shared secret stays in the syslog text.
 */
const RADIUS_SERVERS = {
  dev: serverIp("Dev Callhose"),
  prod: serverIp("Prod Callhose"),
  parking: serverIp("Parking"),
} as const;

export type RadiusDelayCells = {
  afDelay1Dev: string;
  afDelay1Prod: string;
  afDelayParking: string;
};

/** Reply delays from the same attempts the sheet summary names. `0` stays `0`. */
export function radiusDelayCells(text: string): RadiusDelayCells {
  const attempts = readAttempts(text);
  return {
    afDelay1Dev: delayOf(attempts, RADIUS_SERVERS.dev),
    afDelay1Prod: delayOf(attempts, RADIUS_SERVERS.prod),
    afDelayParking: delayOf(attempts, RADIUS_SERVERS.parking),
  };
}

const INT4_MAX = 2_147_483_647;

export type RadiusDelaySamples = {
  afMsDev: number[];
  afMsProd: number[];
  afMsParking: number[];
};

/**
 * The same cells as the table, packed for the delay chart.
 * Dev is «Вход Dev» only. A value that does not fit in Postgres integer is
 * dropped so one bad syslog line cannot fail the card save.
 */
export function radiusDelaySamples(text: string): RadiusDelaySamples {
  const cells = radiusDelayCells(text);
  return {
    afMsDev: parseDelaySamples(cells.afDelay1Dev),
    afMsProd: parseDelaySamples(cells.afDelay1Prod),
    afMsParking: parseDelaySamples(cells.afDelayParking),
  };
}

function parseDelaySamples(...cells: string[]): number[] {
  const samples: number[] = [];
  for (const cell of cells) {
    if (!cell) continue;
    for (const part of cell.split(", ")) {
      if (!/^\d+$/.test(part)) continue;
      const value = Number(part);
      if (!Number.isSafeInteger(value) || value > INT4_MAX) continue;
      samples.push(value);
    }
  }
  return samples;
}

function serverIp(name: string): string {
  for (const [ip, label] of Object.entries(SERVER_NAMES)) {
    if (label === name) return ip;
  }
  return "";
}

function delayOf(attempts: readonly Attempt[], ip: string): string {
  if (!ip) return "";
  const parts: string[] = [];
  for (const attempt of attempts) {
    if (attempt.ip !== ip) continue;
    if (attempt.ms == null) continue;
    parts.push(String(attempt.ms));
  }
  return parts.join(", ");
}

export function summarizeExchange(input: {
  closed: boolean;
  blocks: TraceBlocks;
}): ExchangeSummary {
  const labels = classifyAntifraud(input);
  return {
    category: labels.category,
    status: labels.status,
    servers: rowsOf(readAttempts(input.blocks.text)),
  };
}

export function formatServerLine(row: ServerRow): string {
  const who = row.name ? `${row.name} ${row.ip}` : row.ip;
  const request = `запрос ${String(row.requestId).padStart(3, "0")}`;
  const attempt = row.showAttempt ? `, попытка ${row.attempt}` : "";
  return `${who} — ${row.outcome}, ${request}${attempt}`;
}

function rowsOf(attempts: readonly Attempt[]): ServerRow[] {
  const counts = new Map<number, number>();
  for (const attempt of attempts) counts.set(attempt.id, (counts.get(attempt.id) ?? 0) + 1);
  return attempts.map((attempt) => ({
    name: SERVER_NAMES[attempt.ip] ?? "",
    ip: attempt.ip,
    outcome: outcomeOf(attempt),
    requestId: attempt.id,
    attempt: attempt.attempt,
    showAttempt: (counts.get(attempt.id) ?? 0) > 1,
  }));
}

function outcomeOf(attempt: Attempt): string {
  if (attempt.verdict === "reject") {
    const ms = attempt.ms != null ? `, ${attempt.ms} мс` : "";
    const cut = attempt.released ? ", вызов снят" : "";
    return `Access-Reject${ms}${cut}`;
  }
  if (attempt.verdict === "accept") {
    const ms = attempt.ms != null ? `, ${attempt.ms} мс` : "";
    return `Access-Accept${ms}`;
  }
  if (attempt.exhausted) return "нет ответа, повторы исчерпаны";
  if (attempt.closed) return "нет ответа";
  return "ждём ответ";
}

function readAttempts(text: string): Attempt[] {
  const attempts: Attempt[] = [];
  const pendingIp = new Map<number, string>();

  for (const line of text.split("\n")) {
    const access = line.match(
      /Access request ID\[(\d+)\].*Server\[\d+\]:\s*(\d{1,3}(?:\.\d{1,3}){3})/i,
    );
    if (
      access?.[1] &&
      access[2] &&
      !/is timed out/i.test(line) &&
      !/Skipping/i.test(line)
    ) {
      pendingIp.set(Number(access[1]), access[2]);
    }

    if (isSentLine(line)) {
      const id = requestIdOf(line);
      const ip = id == null ? undefined : pendingIp.get(id);
      if (id != null && ip) {
        const earlier = attempts.filter((attempt) => attempt.id === id);
        const open = earlier.at(-1);
        if (open && open.verdict === "none") open.closed = true;
        if (earlier.length === 0) {
          for (const previous of attempts) {
            if (previous.verdict === "none") previous.exhausted = true;
          }
        }
        attempts.push({
          id,
          attempt: earlier.length + 1,
          ip,
          ms: null,
          verdict: "none",
          exhausted: false,
          closed: false,
          released: false,
        });
      }
    }

    const named = latestAttempt(attempts, requestIdOf(line));
    if (named?.verdict === "none" && /Retries are exhausted|srv-retries exhausted/i.test(line)) {
      named.exhausted = true;
    }
    if (named?.verdict === "none" && /Request timeout|Resend request/i.test(line)) {
      named.closed = true;
    }
    const ms = line.match(/got valid reply[\s\S]*\(in\s+(\d+)\s+ms\)/i);
    if (named && ms?.[1]) named.ms = Number(ms[1]);
    if (named && /Accs-Reply\s*\[accept\]/i.test(line)) named.verdict = "accept";
    if (named && /Accs-Reply\s*\[reject\]/i.test(line)) named.verdict = "reject";
    if (radiusReleaseLine(line) && !timeoutContinue(line)) {
      const reject = [...attempts]
        .reverse()
        .find((attempt) => attempt.verdict === "reject");
      if (reject) reject.released = true;
    }
  }

  return attempts;
}

function latestAttempt(
  attempts: readonly Attempt[],
  id: number | null,
): Attempt | undefined {
  if (id == null) return undefined;
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    if (attempts[index]?.id === id) return attempts[index];
  }
  return undefined;
}

function isSentLine(line: string): boolean {
  return /Request ID\s*\[\d+\]\s+(?:is sent|send)\b/i.test(line);
}

function requestIdOf(line: string): number | null {
  const match = line.match(/Request ID\s*\[(\d+)\]/i);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function timeoutContinue(line: string): boolean {
  if (/release call request/i.test(line) && /Cause:\s*'timeout'/i.test(line)) return true;
  return /Cause\[timeout\]/i.test(line) && /RestrictOut\[no restrict\]/i.test(line);
}
