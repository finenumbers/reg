import { parseRadiusPacket } from "@/modules/smg-trace/packet";
import { radiusReleaseLine } from "@/modules/smg-trace/assemble";
import type { TraceBlocks } from "@/modules/smg-trace/types";

/** Working-table and export column ids. Not CDR file fields. */
export const SMG_ANTIFRAUD_COLUMNS = ["antifraud", "antifraudStatus"] as const;

export type SmgAntifraudColumn = (typeof SMG_ANTIFRAUD_COLUMNS)[number];

export const SMG_ANTIFRAUD_LABELS: Record<SmgAntifraudColumn, string> = {
  antifraud: "АнтиФрод",
  antifraudStatus: "Статус АнтиФрод",
};

export const AF_CATEGORY = {
  waiting: "Ожидание АнтиФрода",
  noData: "Нет данных",
  notChecked: "Не проверялся",
  notSent: "Не отправлялся",
  requestMissing: "Запрос не ушёл",
  passed: "Пропущен",
  passedIn: "Пропущен на входе",
  passedOut: "Пропущен на выходе",
  blockedIn: "Заблокирован на входе",
  blockedOut: "Заблокирован на выходе",
  rejectIgnoredIn: "Отказ на входе не применён",
  rejectIgnoredOut: "Отказ на выходе не применён",
  rejectIgnoredBoth: "Отказ на обоих шагах не применён",
  noReply: "Нет ответа сервера",
  releasedNoReply: "Снят без ответа сервера",
  conflict: "Разбор не сошёлся",
} as const;

export const AF_STATUS = {
  unknown: "Неизвестно",
  noRequest: "Не было запроса",
  firstTry: "С первой попытки",
  retryIn: "Повтор на входе",
  retryOut: "Повтор на выходе",
  retryBoth: "Повтор на обоих шагах",
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

type Side = "in" | "out";
type Verdict = "accept" | "reject" | "none";

type Leg = {
  side: Side | "";
  id: number | null;
  verdict: Verdict;
  conflicted: boolean;
  retried: boolean;
  released: boolean;
  ignored: boolean;
  gotReply: boolean;
};

type Facts = {
  legs: Leg[];
  useAfOff: boolean;
  useAfOn: boolean;
  foreign: boolean;
  callReleased: boolean;
  sideClash: boolean;
};

/**
 * One label pair for a syslog card. An open card stays «Ожидание АнтиФрода»
 * until every sent request has a verdict. A request that has not been sent yet
 * stays waiting too: the exchange can still start.
 */
export function classifyAntifraud(input: {
  closed: boolean;
  blocks: TraceBlocks;
}): AntifraudLabels {
  if (input.closed && input.blocks.mismatch) return conflict();
  const facts = readFacts(input.blocks.text);
  if (!input.closed && replyOutstanding(facts)) return WAITING;
  if (input.blocks.mismatch) return conflict();
  if (facts.sideClash || facts.legs.some((leg) => leg.side === "" || leg.conflicted)) return conflict();

  const category = categoryOf(facts);
  return { category, status: statusOf(category, facts) };
}

function replyOutstanding(facts: Facts): boolean {
  return facts.legs.length === 0 || facts.legs.some((leg) => leg.verdict === "none");
}

export function isSmgAntifraudColumn(column: string): column is SmgAntifraudColumn {
  return (SMG_ANTIFRAUD_COLUMNS as readonly string[]).includes(column);
}

function conflict(): AntifraudLabels {
  return { category: AF_CATEGORY.conflict, status: AF_STATUS.unknown };
}

function categoryOf(facts: Facts): string {
  const incoming = facts.legs.filter((leg) => leg.side === "in");
  const outgoing = facts.legs.filter((leg) => leg.side === "out");
  const inn = sideVerdict(incoming);
  const out = sideVerdict(outgoing);
  const innRelease = incoming.some((leg) => leg.released) || (facts.callReleased && inn === "reject");
  const outRelease = outgoing.some((leg) => leg.released) || (facts.callReleased && out === "reject");

  if (inn === "mixed" || out === "mixed") return AF_CATEGORY.conflict;
  if (inn === "reject" && out === "reject" && innRelease && outRelease) return AF_CATEGORY.conflict;
  if (inn === "reject" && innRelease) return AF_CATEGORY.blockedIn;
  if (out === "reject" && outRelease) return AF_CATEGORY.blockedOut;
  if (inn === "reject" && out === "reject") return AF_CATEGORY.rejectIgnoredBoth;
  if (inn === "reject") return AF_CATEGORY.rejectIgnoredIn;
  if (out === "reject") return AF_CATEGORY.rejectIgnoredOut;

  const hole = facts.legs.some((leg) => leg.verdict === "none");
  if (hole) {
    const anyVerdict = facts.legs.some((leg) => leg.verdict !== "none");
    if (facts.callReleased && !anyVerdict) return AF_CATEGORY.releasedNoReply;
    return AF_CATEGORY.noReply;
  }

  if (incoming.length > 0 && outgoing.length > 0 && inn === "accept" && out === "accept") {
    return AF_CATEGORY.passed;
  }
  if (incoming.length > 0 && outgoing.length === 0 && inn === "accept") return AF_CATEGORY.passedIn;
  if (outgoing.length > 0 && incoming.length === 0 && out === "accept") return AF_CATEGORY.passedOut;

  if (facts.legs.length === 0) {
    if (facts.useAfOn) return AF_CATEGORY.requestMissing;
    if (facts.useAfOff) return AF_CATEGORY.notSent;
    return AF_CATEGORY.notChecked;
  }
  return AF_CATEGORY.conflict;
}

function sideVerdict(legs: readonly Leg[]): Verdict | "mixed" | "empty" {
  if (legs.length === 0) return "empty";
  const accept = legs.some((leg) => leg.verdict === "accept");
  const reject = legs.some((leg) => leg.verdict === "reject");
  if (legs.some((leg) => leg.conflicted) || (accept && reject)) return "mixed";
  if (reject) return "reject";
  if (accept && legs.every((leg) => leg.verdict === "accept")) return "accept";
  return "none";
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

  const retryIn = facts.legs.some((leg) => leg.side === "in" && leg.retried);
  const retryOut = facts.legs.some((leg) => leg.side === "out" && leg.retried);
  if (category === AF_CATEGORY.noReply || category === AF_CATEGORY.releasedNoReply) {
    if (!(retryIn || retryOut)) return AF_STATUS.noAnswer;
  }
  if (retryIn && retryOut) return AF_STATUS.retryBoth;
  if (retryIn) return AF_STATUS.retryIn;
  if (retryOut) return AF_STATUS.retryOut;
  return AF_STATUS.firstTry;
}

function readFacts(text: string): Facts {
  const facts: Facts = {
    legs: [],
    useAfOff: false,
    useAfOn: false,
    foreign: false,
    callReleased: false,
    sideClash: false,
  };
  let pending: Side | "" = "";
  let rcActive = false;
  let rcHex = "";
  let rcStage: "body" | "calc" | "reply" = "body";

  for (const line of text.split("\n")) {
    if (/xpgk-request-type=(?:save_call|check_call)\b/.test(line)) facts.foreign = true;
    if (radiusReleaseLine(line)) {
      facts.callReleased = true;
      const current = facts.legs.at(-1);
      if (current) current.released = true;
    }

    const check = line.match(/USE_AF\s+(\d+).*?\bSD\s+(\d+).*?\bOS\s+(\d+)/);
    if (check?.[1] && check[2] && check[3]) {
      if (check[1] === "0") facts.useAfOff = true;
      if (check[1] === "1") facts.useAfOn = true;
      pending = check[3] === "1" ? "out" : check[2] === "1" ? "in" : "";
    }
    if (/Accs-Request \[(antifraud(?:_out)?)\]/i.test(line)) {
      pending = /antifraud_out/i.test(line) ? "out" : "in";
    }
    const origin = line.match(/h323-call-origin\s*=\s*'(originate|answer)'/i);
    if (origin?.[1]) {
      const side: Side = origin[1].toLowerCase() === "answer" ? "out" : "in";
      const current = facts.legs.at(-1);
      if (current && current.side && current.side !== side) facts.sideClash = true;
      else if (current && !current.side) current.side = side;
      else if (!current) pending = side;
    }

    if (isSentLine(line)) {
      const id = requestIdOf(line);
      const existing = id != null ? facts.legs.find((leg) => leg.id === id) : undefined;
      if (existing) {
        if (attemptNumber(line) > 1) existing.retried = true;
      } else {
        const same = facts.legs.filter((leg) => leg.side !== "" && leg.side === pending);
        const leg: Leg = {
          side: pending,
          id,
          verdict: "none",
          conflicted: false,
          retried: same.length > 0 || attemptNumber(line) > 1,
          released: false,
          ignored: false,
          gotReply: false,
        };
        for (const previous of same) previous.retried = true;
        facts.legs.push(leg);
      }
    } else {
      const n = attemptNumber(line);
      const current = legFor(facts, requestIdOf(line));
      if (current && n > 1) current.retried = true;
    }

    applyVerdict(facts, line);

    if (/\brc:/i.test(line) || rcActive) {
      const step = consumeRc(line, rcActive, rcHex, rcStage);
      rcActive = step.active;
      rcHex = step.hex;
      rcStage = step.stage;
      if (step.packet) applyPacket(facts, step.packet.code, step.packet.id);
    }
  }

  for (const leg of facts.legs) {
    if (leg.ignored && leg.gotReply && leg.verdict === "none") leg.verdict = "accept";
  }
  return facts;
}

function applyVerdict(facts: Facts, line: string): void {
  const id = requestIdOf(line);
  const leg = legFor(facts, id);
  if (!leg) return;
  if (/Accs-Reply\s*\[accept\]/i.test(line)) setVerdict(leg, "accept");
  if (/Accs-Reply\s*\[reject\]/i.test(line)) setVerdict(leg, "reject");
  if (/ignore for not antifraud/i.test(line)) leg.ignored = true;
  if (/got valid reply/i.test(line)) leg.gotReply = true;
}

function applyPacket(facts: Facts, code: number, id: number): void {
  const leg = facts.legs.find((item) => item.id === id);
  if (!leg) return;
  if (code === 2) setVerdict(leg, "accept");
  if (code === 3) setVerdict(leg, "reject");
}

function setVerdict(leg: Leg, verdict: Exclude<Verdict, "none">): void {
  if (leg.verdict === "none") {
    leg.verdict = verdict;
    return;
  }
  if (leg.verdict !== verdict) leg.conflicted = true;
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
): { active: boolean; hex: string; stage: "body" | "calc" | "reply"; packet: { code: number; id: number } | null } {
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
