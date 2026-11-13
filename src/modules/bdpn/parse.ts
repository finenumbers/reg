/**
 * Reads the public BDPN check page. A hit is the four-field card.
 * A miss is the same form echoed back with that number and no card.
 */

export const BDPN_FIELD_MAX = 200;

const INVALID_MESSAGE = "Номер БДПН: ровно 10 цифр, первая 3, 4, 8 или 9.";
const BAD_MESSAGE = "БДПН: неожиданный ответ сервиса.";

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
  nbsp: " ",
};

export type BdpnLookupErrorCode =
  | "INVALID"
  | "REDIRECT"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "NETWORK"
  | "BAD_RESPONSE"
  | "ABORTED";

export class BdpnLookupError extends Error {
  constructor(
    public readonly code: BdpnLookupErrorCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "BdpnLookupError";
  }
}

export type BdpnHit = {
  found: true;
  number: string;
  operator: string;
  territory: string;
  inn: string;
};

export type BdpnMiss = {
  found: false;
  number: string;
};

export type BdpnLookup = BdpnHit | BdpnMiss;

/** Ten digits, first of 3, 4, 8, or 9. A leading 7 is not removed. */
export function acceptedBdpnNumber(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^[3489]\d{9}$/.test(trimmed)) return null;
  return trimmed;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, body: string) => {
    if (body[0] !== "#") {
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
        ? NAMED_ENTITIES[body]
        : full;
    }
    const hex = body[1] === "x" || body[1] === "X";
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return full;
    return String.fromCodePoint(code);
  });
}

function cleanField(raw: string): string | null {
  const text = decodeHtmlEntities(raw).trim();
  if (!text || text.length > BDPN_FIELD_MAX) return null;
  if (/[<>\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function echoedNumber(html: string): string | null {
  const tags = html.match(/<input\b[^>]*\bid=["']phoneInput["'][^>]*>/gi);
  if (!tags || tags.length !== 1) return null;
  const value = tags[0].match(/\bvalue\s*=\s*["']([^"']*)["']/i);
  if (!value) return null;
  return value[1];
}

function badResponse(): BdpnLookupError {
  return new BdpnLookupError("BAD_RESPONSE", BAD_MESSAGE);
}

export function parseBdpnHtml(html: string, number: string): BdpnLookup {
  const expected = acceptedBdpnNumber(number);
  if (!expected) {
    throw new BdpnLookupError("INVALID", INVALID_MESSAGE);
  }

  const card =
    /Номер:\s*(?:<b>\s*)?(\d{10})\s*(?:<\/b>\s*)?<br\s*\/?>\s*Оператор:\s*([^<]{0,300}?)\s*<br\s*\/?>\s*Территория:\s*([^<]{0,300}?)\s*<br\s*\/?>\s*ИНН Оператора:\s*(\d{10}(?:\d{2})?)(?!\d)/g;
  const cards = [...html.matchAll(card)];
  if (cards.length > 1) throw badResponse();
  if (cards.length === 1) {
    const [, cardNumber, operatorRaw, territoryRaw, inn] = cards[0];
    if (cardNumber !== expected) throw badResponse();
    const operator = cleanField(operatorRaw);
    const territory = cleanField(territoryRaw);
    if (!operator || !territory) throw badResponse();
    if (!/^\d{10}(\d{2})?$/.test(inn)) throw badResponse();
    return { found: true, number: expected, operator, territory, inn };
  }

  if (html.includes("Номер:")) throw badResponse();
  // The card is printed after the form. A miss needs the finished page and the empty result shell.
  if (
    echoedNumber(html) === expected &&
    /<\/html>/i.test(html) &&
    /id=["']numResultsContainer["']/i.test(html)
  ) {
    return { found: false, number: expected };
  }
  throw badResponse();
}
