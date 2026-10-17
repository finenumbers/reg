import { radiusReleaseLine } from "@/modules/smg-trace/assemble";
import type { TraceBlocks, TraceLeg } from "@/modules/smg-trace/types";

/** Working-table and export column ids. Not CDR file fields. */
export const SMG_ANTIFRAUD_COLUMNS = ["antifraud", "antifraudStatus"] as const;

export type SmgAntifraudColumn = (typeof SMG_ANTIFRAUD_COLUMNS)[number];

export const SMG_ANTIFRAUD_LABELS: Record<SmgAntifraudColumn, string> = {
  antifraud: "АнтиФрод",
  antifraudStatus: "Статус АнтиФрод",
};

export const AF_CATEGORY = {
  noData: "Нет данных",
  conflict: "Разбор не сошёлся",
  notConsidered: "Не рассматривался",
  notSent: "Не отправлялся",
  requestMissing: "Запрос не ушёл",
  blockedIn: "Заблокирован на входе",
  blockedOut: "Заблокирован на выходе",
  rejectIgnored: "Отказ не применён",
  releasedWithoutReply: "Снят без ответа",
  passedWithoutReply: "Пропущен без ответа",
  replyUnrecorded: "Ответ не зафиксирован",
  passedIn: "Пропущен на входе",
  passedOut: "Пропущен на выходе",
  outOnlyIgnored: "Выход не решал",
  passedOutIgnored: "Пропущен, выход не решал",
  passedBoth: "Пропущен на обоих шагах",
} as const;

export const AF_STATUS = {
  unknown: "Неизвестно",
  noRequest: "Не было запроса",
  wrongType: "Не тип number",
  timeout: "Таймаут",
  codeMissing: "В журнале нет кода",
  retryIn: "Повтор на входе",
  retryOut: "Повтор на выходе",
  retryBoth: "Повтор на обоих шагах",
  firstTry: "С первой попытки",
} as const;

export type AntifraudLabels = {
  category: string;
  status: string;
};

const NO_CARD: AntifraudLabels = {
  category: AF_CATEGORY.noData,
  status: AF_STATUS.unknown,
};

type Side = "in" | "out";
type Verdict = "accept" | "reject" | "ignored" | "none";

type LegFacts = {
  side: Side;
  verdict: Verdict;
  radiusRelease: boolean;
  retried: boolean;
  foreignType: boolean;
};

/**
 * One label pair for a finished syslog card. An open card stays «Нет данных»:
 * the Access reply can still arrive, and the column must not change afterwards
 * from a pass into a block.
 */
export function classifyAntifraud(input: {
  closed: boolean;
  blocks: TraceBlocks;
}): AntifraudLabels {
  if (!input.closed) return NO_CARD;
  if (input.blocks.antifraud.mismatch) return conflict();

  const sent: LegFacts[] = [];
  let useAfOff = false;
  let useAfOnUnsent = false;
  for (const leg of input.blocks.antifraud.legs) {
    if (isSent(leg)) {
      const facts = sentFacts(leg);
      if (!facts) return conflict();
      sent.push(facts);
    } else if (leg.useAf === "0") {
      useAfOff = true;
    } else if (leg.useAf === "1" && (leg.side === "in" || leg.side === "out")) {
      useAfOnUnsent = true;
    }
  }

  const incoming = sent.filter((leg) => leg.side === "in");
  const outgoing = sent.filter((leg) => leg.side === "out");
  if (incoming.length > 1 || outgoing.length > 1) return conflict();

  if (sent.length === 0) {
    if (useAfOnUnsent) return { category: AF_CATEGORY.requestMissing, status: AF_STATUS.unknown };
    if (useAfOff) return { category: AF_CATEGORY.notSent, status: AF_STATUS.noRequest };
    if (sawStart(input.blocks)) {
      return { category: AF_CATEGORY.notConsidered, status: AF_STATUS.unknown };
    }
    return NO_CARD;
  }

  const category = categoryOf(incoming[0], outgoing[0]);
  return { category, status: statusOf(category, sent) };
}

export function isSmgAntifraudColumn(column: string): column is SmgAntifraudColumn {
  return (SMG_ANTIFRAUD_COLUMNS as readonly string[]).includes(column);
}

function conflict(): AntifraudLabels {
  return { category: AF_CATEGORY.conflict, status: AF_STATUS.unknown };
}

function categoryOf(incoming: LegFacts | undefined, outgoing: LegFacts | undefined): string {
  const innReject = incoming?.verdict === "reject";
  const outReject = outgoing?.verdict === "reject";
  const innRelease = incoming?.radiusRelease === true;
  const outRelease = outgoing?.radiusRelease === true;

  if (innReject && outReject && innRelease && outRelease) return AF_CATEGORY.conflict;
  if (innReject && innRelease) return AF_CATEGORY.blockedIn;
  if (outReject && outRelease) return AF_CATEGORY.blockedOut;
  if (innReject || outReject) return AF_CATEGORY.rejectIgnored;
  if (innRelease || outRelease) return AF_CATEGORY.releasedWithoutReply;

  const hole = incoming?.verdict === "none" ? incoming : outgoing?.verdict === "none" ? outgoing : undefined;
  if (hole) {
    return hole.retried ? AF_CATEGORY.passedWithoutReply : AF_CATEGORY.replyUnrecorded;
  }

  if (incoming?.verdict === "accept" && !outgoing) return AF_CATEGORY.passedIn;
  if (!incoming && outgoing?.verdict === "accept") return AF_CATEGORY.passedOut;
  if (!incoming && outgoing?.verdict === "ignored") return AF_CATEGORY.outOnlyIgnored;
  if (incoming?.verdict === "accept" && outgoing?.verdict === "ignored") {
    return AF_CATEGORY.passedOutIgnored;
  }
  if (incoming?.verdict === "accept" && outgoing?.verdict === "accept") return AF_CATEGORY.passedBoth;
  return AF_CATEGORY.conflict;
}

function statusOf(category: string, sent: readonly LegFacts[]): string {
  if (
    category === AF_CATEGORY.conflict ||
    category === AF_CATEGORY.requestMissing ||
    category === AF_CATEGORY.noData ||
    category === AF_CATEGORY.notConsidered
  ) {
    return AF_STATUS.unknown;
  }
  if (category === AF_CATEGORY.notSent) return AF_STATUS.noRequest;
  if (sent.some((leg) => leg.foreignType)) return AF_STATUS.wrongType;
  if (category === AF_CATEGORY.passedWithoutReply || category === AF_CATEGORY.releasedWithoutReply) {
    return AF_STATUS.timeout;
  }
  if (category === AF_CATEGORY.replyUnrecorded) return AF_STATUS.codeMissing;

  const retryIn = sent.some((leg) => leg.side === "in" && leg.retried);
  const retryOut = sent.some((leg) => leg.side === "out" && leg.retried);
  if (retryIn && retryOut) return AF_STATUS.retryBoth;
  if (retryIn) return AF_STATUS.retryIn;
  if (retryOut) return AF_STATUS.retryOut;
  return AF_STATUS.firstTry;
}

function isSent(leg: TraceLeg): boolean {
  return Boolean(
    leg.requestId ||
      leg.attributes.length > 0 ||
      leg.reply ||
      leg.replyCode ||
      leg.ignored,
  );
}

function sentFacts(leg: TraceLeg): LegFacts | null {
  const side = sideOf(leg);
  const verdict = verdictOf(leg);
  if (!side || !verdict) return null;
  return {
    side,
    verdict,
    radiusRelease: radiusReleaseLine(leg.released),
    retried: retried(leg),
    foreignType: leg.requestType === "save_call" || leg.requestType === "check_call",
  };
}

function sideOf(leg: TraceLeg): Side | null {
  const fromBracket = leg.side === "in" || leg.side === "out" ? leg.side : "";
  const fromOrigin =
    leg.origin === "originate" ? "in" : leg.origin === "answer" ? "out" : "";
  if (fromBracket && fromOrigin && fromBracket !== fromOrigin) return null;
  const side = fromBracket || fromOrigin;
  return side || null;
}

function verdictOf(leg: TraceLeg): Verdict | null {
  if (leg.ignored.trim()) return "ignored";
  const code = leg.replyCode.trim();
  const reply = leg.reply.trim().toLowerCase();
  const codeAccept = code.startsWith("2");
  const codeReject = code.startsWith("3");
  const textAccept = reply === "accept";
  const textReject = reply === "reject";
  if ((codeAccept && textReject) || (codeReject && textAccept)) return null;
  if (codeReject || textReject) return "reject";
  if (codeAccept || textAccept) return "accept";
  return "none";
}

function retried(leg: TraceLeg): boolean {
  const match = leg.attempts.trim().match(/^(\d+)\s+of\s+\d+/);
  return Boolean(match?.[1] && Number(match[1]) > 1);
}

function sawStart(blocks: TraceBlocks): boolean {
  if (blocks.times.some((row) => row.event === "Setup")) return true;
  if (blocks.numbers.length > 0) return true;
  return blocks.signal.some((leg) =>
    leg.messages.some((message) => message === "IAM" || message === "INVITE"),
  );
}
