/**
 * Display total for the cost-estimate «Стоимость» footer.
 * Example: 1000033 kopecks → «10 000,33».
 */

const CHARGE_RE = /^-?\d+\.\d{2}$/;

/** Parse rater charge text («3.00») to kopecks, or null when empty/invalid. */
export function chargeToKopecks(charge: string): bigint | null {
  const trimmed = charge.trim();
  if (!trimmed) return null;
  if (!CHARGE_RE.test(trimmed)) return null;
  const neg = trimmed.startsWith("-");
  const body = neg ? trimmed.slice(1) : trimmed;
  const [whole = "0", frac = "00"] = body.split(".");
  const k = BigInt(whole) * BigInt(100) + BigInt(frac);
  return neg ? -k : k;
}

export function sumChargeKopecks(charges: readonly string[]): bigint {
  let sum = BigInt(0);
  for (const charge of charges) {
    const k = chargeToKopecks(charge);
    if (k != null) sum += k;
  }
  return sum;
}

/** Regular space thousands + comma decimals, two places. */
export function formatCostEstimateTotal(kopecks: bigint): string {
  const neg = kopecks < BigInt(0);
  const abs = neg ? -kopecks : kopecks;
  const whole = abs / BigInt(100);
  const frac = (abs % BigInt(100)).toString().padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "-" : ""}${grouped},${frac}`;
}

export function chargeToExcelNumber(charge: string): number | null {
  const k = chargeToKopecks(charge);
  if (k == null) return null;
  return Number(k) / 100;
}
