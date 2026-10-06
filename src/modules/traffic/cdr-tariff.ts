/**
 * Per-call tariff cells for the raw CDR table.
 * The SQL function cdr_rate_call in the migration is the same rule.
 * Money is integer kopecks: CEIL toward +infinity, always two decimal places.
 */

import { formatTariffDecimal } from "@/modules/tariffs/parse-xlsx";
import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";

export const CDR_TARIFF_COLUMNS = [
  "tariff_direction",
  "tariff_charge",
  "tariff_cost",
  "tariff_profit",
] as const;

export type CdrTariffColumn = (typeof CDR_TARIFF_COLUMNS)[number];

export const CDR_TARIFF_LABELS: Record<CdrTariffColumn, string> = {
  tariff_direction: "Направление",
  tariff_charge: "Стоимость",
  tariff_cost: "Себестоимость",
  tariff_profit: "Прибыль",
};

/** Hidden from API keys. Profit reveals cost once charge is known. */
export const CDR_TARIFF_SECRET_COLUMNS = ["tariff_cost", "tariff_profit"] as const;

export type CdrTariffCells = {
  direction: string;
  charge: string;
  cost: string;
  profit: string;
  /** Catalog per-minute price, same text as «Тарификация». */
  price: string;
};

export const EMPTY_CDR_TARIFF: CdrTariffCells = {
  direction: "",
  charge: "",
  cost: "",
  profit: "",
  price: "",
};

const RATED_FULL = new Set<string>([
  CALL_CATEGORY.outgoing,
  CALL_CATEGORY.internal,
  CALL_CATEGORY.redirect,
]);

/** 12 integer digits: abs(kopecks) >= 100 * 10^12. */
const KOPECK_OVERFLOW = BigInt("100000000000000");
const PRICE_SCALE = BigInt(1000000);
const CHARGE_DIVISOR = BigInt(10000);
const COST_DIVISOR = BigInt(600000);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);
const THOUSAND = BigInt(1000);
const SIXTY = BigInt(60);

export type TariffRateLookup = {
  direction: string;
  abc: string;
  price: string;
  cost: string;
  sortIndex: number;
};

export function isCdrTariffSecretColumn(column: string): boolean {
  return (CDR_TARIFF_SECRET_COLUMNS as readonly string[]).includes(column);
}

export function stripCdrTariffSecrets<T extends Record<string, string>>(data: T): T {
  const next = { ...data };
  delete next.tariff_cost;
  delete next.tariff_profit;
  return next;
}

export function omitCdrTariffSecretFilters<T extends Record<string, unknown>>(
  filters: T,
): T {
  const next = { ...filters };
  delete next.tariff_cost;
  delete next.tariff_profit;
  return next;
}

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

function matchAbc(number: string, rates: readonly TariffRateLookup[]): TariffRateLookup | null {
  let best: TariffRateLookup | null = null;
  for (const rate of rates) {
    if (!rate.abc || !number.startsWith(rate.abc)) continue;
    if (
      !best ||
      rate.abc.length > best.abc.length ||
      (rate.abc.length === best.abc.length && rate.sortIndex < best.sortIndex)
    ) {
      best = rate;
    }
  }
  return best;
}

export function rateCdrCall(input: {
  category: string;
  status: string;
  billDnis: string;
  elapsedTime: string;
  rates: readonly TariffRateLookup[];
}): CdrTariffCells {
  const parking = input.category === CALL_CATEGORY.outgoingParking;
  if (input.status !== CALL_STATUS.success) return EMPTY_CDR_TARIFF;
  if (!parking && !RATED_FULL.has(input.category)) return EMPTY_CDR_TARIFF;

  const number = input.billDnis.trim();
  if (!/^7\d{10}$/.test(number)) return EMPTY_CDR_TARIFF;

  const rate = matchAbc(number, input.rates);
  if (!rate) return EMPTY_CDR_TARIFF;

  const price6 = parseScale6(rate.price);
  const cost6 = parseScale6(rate.cost);
  if (price6 == null || cost6 == null) return EMPTY_CDR_TARIFF;

  const seconds = elapsedMsToCeiledSeconds(input.elapsedTime);
  const minutes = divCeilPositive(seconds, SIXTY);
  const chargeK = kopecksFromScale6(minutes * price6, CHARGE_DIVISOR, BigInt(9999));
  const costK = parking
    ? ZERO
    : kopecksFromScale6(seconds * cost6, COST_DIVISOR, BigInt(599999));
  const profitK = chargeK - costK;

  const charge = formatKopecks(chargeK);
  const cost = formatKopecks(costK);
  const profit = formatKopecks(profitK);
  if (charge == null || cost == null || profit == null) return EMPTY_CDR_TARIFF;

  return {
    direction: rate.direction,
    charge,
    cost,
    profit,
    price: formatTariffDecimal(rate.price),
  };
}
