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
  requestIds: number[];
};

export type ExchangeSummary = {
  category: string;
  status: string;
  servers: ServerRow[];
};

type Verdict = "none" | "accept" | "reject";

type Attempt = {
  id: number;
  ip: string;
  ms: number | null;
  verdict: Verdict;
  exhausted: boolean;
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
  return `${who} — ${row.outcome}, ${requestPhrase(row.requestIds)}`;
}

function requestPhrase(ids: readonly number[]): string {
  const padded = ids.map((id) => String(id).padStart(3, "0"));
  if (padded.length === 0) return "";
  if (padded.length === 1) return `запрос ${padded[0]}`;
  if (padded.length === 2) return `запросы ${padded[0]} и ${padded[1]}`;
  return `запросы ${padded.slice(0, -1).join(", ")} и ${padded.at(-1)}`;
}

function rowsOf(attempts: readonly Attempt[]): ServerRow[] {
  const rows: { ip: string; attempts: Attempt[] }[] = [];
  for (const attempt of attempts) {
    const row = rows.find((item) => item.ip === attempt.ip);
    if (row) row.attempts.push(attempt);
    else rows.push({ ip: attempt.ip, attempts: [attempt] });
  }
  return rows.map((row) => ({
    name: SERVER_NAMES[row.ip] ?? "",
    ip: row.ip,
    outcome: outcomeOf(row.attempts),
    requestIds: row.attempts.map((attempt) => attempt.id),
  }));
}

function outcomeOf(attempts: readonly Attempt[]): string {
  const decided = [...attempts].reverse().find((attempt) => attempt.verdict !== "none");
  if (decided?.verdict === "reject") {
    const ms = decided.ms != null ? `, ${decided.ms} мс` : "";
    const cut = decided.released ? ", вызов снят" : "";
    return `Access-Reject${ms}${cut}`;
  }
  if (decided?.verdict === "accept") {
    const ms = decided.ms != null ? `, ${decided.ms} мс` : "";
    return `Access-Accept${ms}`;
  }
  if (attempts.every((attempt) => attempt.exhausted))
    return "нет ответа, повторы исчерпаны";
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
      if (id != null && ip && !attempts.some((attempt) => attempt.id === id)) {
        for (const previous of attempts) {
          if (previous.verdict === "none") previous.exhausted = true;
        }
        attempts.push({
          id,
          ip,
          ms: null,
          verdict: "none",
          exhausted: false,
          released: false,
        });
      }
    }

    const named = attemptById(attempts, requestIdOf(line));
    if (named && /Retries are exhausted|srv-retries exhausted/i.test(line))
      named.exhausted = true;
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

function attemptById(
  attempts: readonly Attempt[],
  id: number | null,
): Attempt | undefined {
  if (id == null) return undefined;
  return attempts.find((attempt) => attempt.id === id);
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
