import { parseRadiusPacket } from "@/modules/smg-trace/packet";
import { radiusReleaseLine } from "@/modules/smg-trace/assemble";
import type { TraceBlocks } from "@/modules/smg-trace/types";

/** Milliseconds from the syslog card. Not CDR file fields and not facet menus. */
export const SMG_RADIUS_DELAY_COLUMNS = [
  "afDelay1Dev",
  "afDelay1Prod",
  "afDelayParking",
] as const;

export type SmgRadiusDelayColumn = (typeof SMG_RADIUS_DELAY_COLUMNS)[number];

/** Working-table and export column ids. Not CDR file fields. */
export const SMG_ANTIFRAUD_COLUMNS = [
  "antifraud",
  "antifraudStatus",
  ...SMG_RADIUS_DELAY_COLUMNS,
] as const;

export type SmgAntifraudColumn = (typeof SMG_ANTIFRAUD_COLUMNS)[number];

export const SMG_ANTIFRAUD_LABELS: Record<SmgAntifraudColumn, string> = {
  antifraud: "АнтиФрод",
  antifraudStatus: "Статус АнтиФрод",
  afDelay1Dev: "Вход Dev",
  afDelay1Prod: "Вход Prod",
  afDelayParking: "Parking",
};

export const AF_CATEGORY = {
  waiting: "Ожидание АнтиФрода",
  noData: "Нет данных",
  notChecked: "Не проверялся",
  notSent: "Не отправлялся",
  requestMissing: "Запрос не ушёл",
  passed: "Пропущен",
  blocked: "Заблокирован",
  rejectIgnored: "Отказ не применён",
  noReply: "Нет ответа сервера",
  releasedNoReply: "Снят без ответа сервера",
  conflict: "Разбор не сошёлся",
} as const;

export const AF_STATUS = {
  unknown: "Неизвестно",
  noRequest: "Не было запроса",
  firstTry: "С первой попытки",
  retry: "Повтор",
  noAnswer: "Нет ответа",
  wrongType: "Не тип number",
} as const;

export type AntifraudLabels = {
  category: string;
  status: string;
};

const WAITING: AntifraudLabels = {
  category: AF_CATEGORY.waiting,
  status: AF_STATUS.unknown,
};

type Verdict = "accept" | "reject" | "none";

type VerdictSource = "" | "packet" | "text";

type Leg = {
  id: number | null;
  verdict: Verdict;
  verdictFrom: VerdictSource;
  conflicted: boolean;
  retried: boolean;
  released: boolean;
  gotReply: boolean;
  /** `srv-retries exhausted`: this request will not be answered. */
  exhausted: boolean;
};

type Facts = {
  legs: Leg[];
  /** `Set RADIUS-profile`, not the license `Set Antifraud RADIUS-profile` line. */
  profile: boolean;
  foreign: boolean;
  callReleased: boolean;
};

/**
 * One label pair for one out-seize exchange.
 * An open card stays «Ожидание АнтиФрода» until every sent request has a verdict
 * or is exhausted. USE_AF probes do not decide. A mismatched open card stays
 * waiting until those replies are in.
 */
export function classifyAntifraud(input: {
  closed: boolean;
  blocks: TraceBlocks;
}): AntifraudLabels {
  const facts = readFacts(input.blocks.text);
  if (!input.closed && replyOutstanding(facts)) {
    const anyVerdict = facts.legs.some((leg) => leg.verdict !== "none" || leg.conflicted);
    if ((input.blocks.mismatch && anyVerdict) || facts.legs.some((leg) => leg.conflicted)) {
      return conflict();
    }
    return WAITING;
  }
  if (input.blocks.mismatch) return conflict();
  if (facts.legs.some((leg) => leg.conflicted)) return conflict();

  const category = categoryOf(facts);
  return { category, status: statusOf(category, facts) };
}

/**
 * An open exchange waits until some request has a verdict.
 * One exhausted server still waits while the next request has not been sent.
 * A later verdict closes that wait.
 */
function replyOutstanding(facts: Facts): boolean {
  if (facts.legs.length === 0) return true;
  if (facts.legs.every((leg) => leg.verdict === "none")) return true;
  return facts.legs.some((leg) => leg.verdict === "none" && !leg.exhausted);
}

export function isSmgAntifraudColumn(column: string): column is SmgAntifraudColumn {
  return (SMG_ANTIFRAUD_COLUMNS as readonly string[]).includes(column);
}

function conflict(): AntifraudLabels {
  return { category: AF_CATEGORY.conflict, status: AF_STATUS.unknown };
}

/** The last request that already has a verdict. An earlier timeout or reject is a retry. */
function categoryOf(facts: Facts): string {
  const decided = facts.legs.filter(
    (leg) => !(leg.exhausted && leg.verdict === "none") && leg.verdict !== "none",
  );
  const pending = facts.legs.some((leg) => leg.verdict === "none" && !leg.exhausted);
  if (pending || (facts.legs.length > 0 && decided.length === 0)) {
    if (facts.callReleased && decided.length === 0) return AF_CATEGORY.releasedNoReply;
    return AF_CATEGORY.noReply;
  }
  if (decided.length === 0) {
    if (facts.profile) return AF_CATEGORY.requestMissing;
    return AF_CATEGORY.notChecked;
  }
  const last = decided.at(-1)!;
  if (last.verdict === "reject") {
    if (last.released || facts.callReleased) return AF_CATEGORY.blocked;
    return AF_CATEGORY.rejectIgnored;
  }
  if (last.verdict === "accept") return AF_CATEGORY.passed;
  return AF_CATEGORY.conflict;
}

function statusOf(category: string, facts: Facts): string {
  if (
    category === AF_CATEGORY.conflict ||
    category === AF_CATEGORY.requestMissing ||
    category === AF_CATEGORY.notChecked ||
    category === AF_CATEGORY.waiting ||
    category === AF_CATEGORY.noData
  ) {
    return AF_STATUS.unknown;
  }
  if (category === AF_CATEGORY.notSent) return AF_STATUS.noRequest;
  if (facts.foreign) return AF_STATUS.wrongType;
  const retried = facts.legs.some((leg) => leg.retried);
  if (
    (category === AF_CATEGORY.noReply || category === AF_CATEGORY.releasedNoReply) &&
    !retried
  ) {
    return AF_STATUS.noAnswer;
  }
  if (retried) return AF_STATUS.retry;
  return AF_STATUS.firstTry;
}

function readFacts(text: string): Facts {
  const facts: Facts = {
    legs: [],
    profile: false,
    foreign: false,
    callReleased: false,
  };
  let rcActive = false;
  let rcHex = "";
  let rcStage: "body" | "calc" | "reply" = "body";

  for (const line of text.split("\n")) {
    const requestType = line.match(/xpgk-request-type=([^\s']+)/);
    if (requestType?.[1] && requestType[1] !== "number") facts.foreign = true;
    if (/Set RADIUS-profile\b/i.test(line)) facts.profile = true;
    if (radiusReleaseLine(line) && !timeoutContinue(line)) {
      facts.callReleased = true;
      const current = facts.legs.at(-1);
      if (current) current.released = true;
    }

    if (isSentLine(line)) {
      const id = requestIdOf(line);
      const existing = id != null ? facts.legs.find((leg) => leg.id === id) : undefined;
      if (existing) {
        if (attemptNumber(line) > 1) existing.retried = true;
      } else {
        const leg: Leg = {
          id,
          verdict: "none",
          verdictFrom: "",
          conflicted: false,
          retried: facts.legs.length > 0 || attemptNumber(line) > 1,
          released: false,
          gotReply: false,
          exhausted: false,
        };
        for (const previous of facts.legs) {
          previous.retried = true;
          if (previous.verdict === "none") previous.exhausted = true;
        }
        facts.legs.push(leg);
      }
    } else {
      const n = attemptNumber(line);
      const current = legFor(facts, requestIdOf(line));
      if (current && n > 1) current.retried = true;
    }

    applyVerdict(facts, line);
    const named = legById(facts, requestIdOf(line));
    if (named && /srv-retries exhausted|retries exhausted/i.test(line)) named.exhausted = true;
    if (named?.verdictFrom === "packet" && /invalid reply|Silent ignore/i.test(line)) {
      named.verdict = "none";
      named.verdictFrom = "";
      named.conflicted = false;
    }

    if (/\brc:/i.test(line) || rcActive) {
      const step = consumeRc(line, rcActive, rcHex, rcStage);
      rcActive = step.active;
      rcHex = step.hex;
      rcStage = step.stage;
      if (step.packet) applyPacket(facts, step.packet.code, step.packet.id);
    }
  }

  return facts;
}

function applyVerdict(facts: Facts, line: string): void {
  const leg = legFor(facts, requestIdOf(line));
  if (!leg) return;
  if (/Accs-Reply\s*\[accept\]/i.test(line)) setVerdict(leg, "accept", "text");
  if (/Accs-Reply\s*\[reject\]/i.test(line)) setVerdict(leg, "reject", "text");
  if (/got valid reply/i.test(line)) leg.gotReply = true;
}

function applyPacket(facts: Facts, code: number, id: number): void {
  const leg = facts.legs.find((item) => item.id === id);
  if (!leg) return;
  if (code === 2) setVerdict(leg, "accept", "packet");
  if (code === 3) setVerdict(leg, "reject", "packet");
}

function setVerdict(
  leg: Leg,
  verdict: Exclude<Verdict, "none">,
  source: Exclude<VerdictSource, "">,
): void {
  if (leg.verdict === "none") {
    leg.verdict = verdict;
    leg.verdictFrom = source;
    return;
  }
  if (leg.verdict !== verdict) leg.conflicted = true;
  if (source === "text") leg.verdictFrom = "text";
}

/** A timeout that continues the call is not an antifraud release. */
function timeoutContinue(line: string): boolean {
  if (/release call request/i.test(line) && /Cause:\s*'timeout'/i.test(line)) return true;
  return /Cause\[timeout\]/i.test(line) && /RestrictOut\[no restrict\]/i.test(line);
}

function legById(facts: Facts, id: number | null): Leg | undefined {
  if (id == null) return undefined;
  return facts.legs.find((leg) => leg.id === id);
}

function legFor(facts: Facts, id: number | null): Leg | undefined {
  if (id != null) {
    const found = facts.legs.find((leg) => leg.id === id);
    if (found) return found;
  }
  return facts.legs.at(-1);
}

function isSentLine(line: string): boolean {
  return /Request ID\s*\[\d+\]\s+(?:is sent|send)\b/i.test(line);
}

function requestIdOf(line: string): number | null {
  const match = line.match(/Request ID\s*\[(\d+)\]/i);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function attemptNumber(line: string): number {
  const of = line.match(/(\d+)\s+of\s+\d+/i);
  if (of?.[1]) return Number(of[1]);
  const attempt = line.match(/Attempt:?\s*(\d+)/i);
  if (attempt?.[1]) return Number(attempt[1]);
  return 1;
}

function consumeRc(
  line: string,
  active: boolean,
  hex: string,
  stage: "body" | "calc" | "reply",
): {
  active: boolean;
  hex: string;
  stage: "body" | "calc" | "reply";
  packet: { code: number; id: number } | null;
} {
  const payload = line.replace(/^.*\brc:\s*/i, "").trim();
  if (/Calculating digest on/i.test(payload)) {
    return { active: true, hex: "", stage: "body", packet: null };
  }
  if (!active) return { active: false, hex: "", stage: "body", packet: null };
  if (stage === "body" && /Calculated digest/i.test(payload)) {
    return { active: true, hex, stage: "calc", packet: null };
  }
  if (stage === "calc" && /Reply digest/i.test(payload)) {
    return { active: true, hex, stage: "reply", packet: null };
  }
  const digits = payload.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]{8,}$/.test(digits)) {
    if (stage === "body") return { active: true, hex: hex + digits, stage, packet: null };
    if (stage === "reply") {
      const parsed = parseRadiusPacket(hex);
      return {
        active: false,
        hex: "",
        stage: "body",
        packet: parsed ? { code: parsed.code, id: parsed.id } : null,
      };
    }
    return { active: true, hex, stage, packet: null };
  }
  return { active: false, hex: "", stage: "body", packet: null };
}
