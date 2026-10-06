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
  const zero = BigInt(0);
  const one = BigInt(1);
  const two = BigInt(2);
  const ten = BigInt(10);
  const hundred = BigInt(100);
  let scaled = BigInt(digits);
  if (target > 0) {
    const div = ten ** BigInt(target);
    const rem = scaled % div;
    scaled /= div;
    if (rem * two >= div) scaled += one;
  } else if (target < 0) {
    scaled *= ten ** BigInt(-target);
  }
  const whole = scaled / hundred;
  const frac = (scaled % hundred).toString().padStart(2, "0");
  return `${neg && scaled !== zero ? "-" : ""}${whole.toString()}.${frac}`;
}
