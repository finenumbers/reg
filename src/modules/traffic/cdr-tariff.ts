/**
 * Per-call tariff cells for the raw CDR table.
 * The SQL function cdr_rate_call in the migration is the same rule.
 * Money is integer kopecks: CEIL toward +infinity, always two decimal places.
 */

import { MINUTE_GRACE_SECONDS } from "@/modules/enrich/types";
import { formatTariffDecimal } from "@/modules/tariffs/parse-xlsx";
import { CALL_CATEGORY, CALL_STATUS, CALL_TYPE } from "@/modules/traffic/call-class";
import { matchTariffAbc } from "@/modules/traffic/tariff-match";

export const CDR_TARIFF_COLUMNS = ["tariff_direction", "tariff_charge"] as const;

export type CdrTariffColumn = (typeof CDR_TARIFF_COLUMNS)[number];

export const CDR_TARIFF_LABELS: Record<CdrTariffColumn, string> = {
  tariff_direction: "Направление",
  tariff_charge: "Стоимость",
};

export type CdrTariffCells = {
  direction: string;
  charge: string;
  /** Catalog per-minute price, same text as «Тарификация». */
  price: string;
};

export const EMPTY_CDR_TARIFF: CdrTariffCells = {
  direction: "",
  charge: "",
  price: "",
};

const RATED_TYPES = new Set<string>([
  CALL_TYPE.intercity,
  CALL_TYPE.international,
  CALL_TYPE.redirect,
]);

/** 12 integer digits: abs(kopecks) >= 100 * 10^12. */
const KOPECK_OVERFLOW = BigInt("100000000000000");
const PRICE_SCALE = BigInt(1000000);
const CHARGE_DIVISOR = BigInt(10000);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);
const THOUSAND = BigInt(1000);
const SIXTY = BigInt(60);
const MINUTE_GRACE = BigInt(MINUTE_GRACE_SECONDS);

export type TariffRateLookup = {
  direction: string;
  abc: string;
  price: string;
  sortIndex: number;
};

/** CEIL(ms/1000). Non-numeric and negative durations are 0 seconds. */
export function elapsedMsToCeiledSeconds(raw: string): bigint {
  const trimmed = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return ZERO;
  const [intRaw, frac = ""] = trimmed.split(".");
  const intPart = BigInt(intRaw!);
  if (frac.length === 0 || /^0+$/.test(frac)) {
    return divCeilPositive(intPart, THOUSAND);
  }
  const scale = TEN ** BigInt(frac.length);
  const msScaled = intPart * scale + BigInt(frac);
  return divCeilPositive(msScaled, THOUSAND * scale);
}

function divCeilPositive(n: bigint, d: bigint): bigint {
  if (n <= ZERO) return ZERO;
  return (n + d - ONE) / d;
}

/** Tariff decimal with at most 6 fractional digits, as scale 10^6. */
function parseScale6(text: string): bigint | null {
  const neg = text.startsWith("-");
  const body = neg ? text.slice(1) : text;
  if (!/^\d+(\.\d+)?$/.test(body)) return null;
  const [intRaw, frac = ""] = body.split(".");
  if (frac.length > 6) return null;
  const fracPadded = (frac + "000000").slice(0, 6);
  const scale = BigInt(intRaw!) * PRICE_SCALE + BigInt(fracPadded);
  return neg ? -scale : scale;
}

/**
 * Kopecks from a scale-6 integer.
 * Positive: ceil via (n + slack) / divisor. Negative: trunc toward 0, which is CEIL.
 */
function kopecksFromScale6(num: bigint, divisor: bigint, slack: bigint): bigint {
  if (num > ZERO) return (num + slack) / divisor;
  if (num < ZERO) return num / divisor;
  return ZERO;
}

function formatKopecks(k: bigint): string | null {
  const abs = k < ZERO ? -k : k;
  if (abs >= KOPECK_OVERFLOW) return null;
  const whole = abs / HUNDRED;
  const frac = (abs % HUNDRED).toString().padStart(2, "0");
  return `${k < ZERO ? "-" : ""}${whole.toString()}.${frac}`;
}

function matchedDirection(
  billDnis: string,
  rates: readonly TariffRateLookup[],
): TariffRateLookup | null {
  const number = billDnis.trim();
  if (!/^7\d{10}$/.test(number)) return null;
  return matchTariffAbc(number, rates) ?? null;
}

export function rateCdrCall(input: {
  category: string;
  callType: string;
  status: string;
  billDnis: string;
  elapsedTime: string;
  rates: readonly TariffRateLookup[];
}): CdrTariffCells {
  if (input.category !== CALL_CATEGORY.outgoing) return EMPTY_CDR_TARIFF;
  if (input.status !== CALL_STATUS.success && input.status !== CALL_STATUS.parking) {
    return EMPTY_CDR_TARIFF;
  }

  const rate = matchedDirection(input.billDnis, input.rates);
  if (!rate) return EMPTY_CDR_TARIFF;

  if (input.callType === CALL_TYPE.local) {
    return { direction: rate.direction, charge: "", price: "" };
  }
  if (!RATED_TYPES.has(input.callType)) return EMPTY_CDR_TARIFF;

  const price6 = parseScale6(rate.price);
  if (price6 == null) return EMPTY_CDR_TARIFF;

  const seconds = elapsedMsToCeiledSeconds(input.elapsedTime);
  const minutes = seconds <= MINUTE_GRACE ? ZERO : divCeilPositive(seconds, SIXTY);
  const chargeK = kopecksFromScale6(minutes * price6, CHARGE_DIVISOR, BigInt(9999));
  const charge = formatKopecks(chargeK);
  if (charge == null) return EMPTY_CDR_TARIFF;

  return {
    direction: rate.direction,
    charge,
    price: formatTariffDecimal(rate.price),
  };
}
