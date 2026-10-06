/**
 * Table text for «Цена» and «Стоимость»: exactly two decimal places.
 * A blank cell stays blank. Stored catalog precision is unchanged.
 */

export function formatMoney2(raw: string): string {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return "";
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return raw;
  const neg = trimmed.startsWith("-");
  const body = neg ? trimmed.slice(1) : trimmed;
  const [intRaw = "0", fracRaw = ""] = body.split(".");
  const digits = `${intRaw}${fracRaw}`.replace(/^0+(?=\d)/, "") || "0";
  const scale = fracRaw.length;
  const target = scale - 2;
  let scaled = BigInt(digits);
  if (target > 0) {
    const div = 10n ** BigInt(target);
    const rem = scaled % div;
    scaled /= div;
    if (rem * 2n >= div) scaled += 1n;
  } else if (target < 0) {
    scaled *= 10n ** BigInt(-target);
  }
  const whole = scaled / 100n;
  const frac = (scaled % 100n).toString().padStart(2, "0");
  return `${neg && scaled !== 0n ? "-" : ""}${whole.toString()}.${frac}`;
}
