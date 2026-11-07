/**
 * Screen split after the tariff row is already chosen.
 * One positive overlap strips a suffix of the tariff ABC.
 * A short ABC that starts with 79 completes the national code from the
 * phone and leaves the leading 7 out of the screen cells.
 * geography_digit_split repeats this rule.
 */

export type CityDigitSplit = {
  abc: string;
  telephone: string;
};

/** National code for one short numbering value, or null when the gates are closed. */
function nationalCode(number: string, tariffAbc: string, n: number): string | null {
  if (!/^7\d{10}$/.test(number)) return null;
  if (!tariffAbc.startsWith("79")) return null;
  const width = number.length - n - 1;
  if (width < 1) return null;
  const code = number.slice(1, number.length - n);
  const prefix = tariffAbc.slice(1);
  if (code.length < prefix.length || !code.startsWith(prefix)) return null;
  return code;
}

export function cityDigitSplit(
  number: string,
  tariffAbc: string | null | undefined,
  numbering: readonly number[] | null | undefined,
): CityDigitSplit {
  const abc = tariffAbc ?? "";
  if (!abc) return { abc: "", telephone: "" };
  const trimmed = number.trim();
  if (!trimmed.startsWith(abc)) return { abc, telephone: "" };
  const positive: number[] = [];
  const short: number[] = [];
  for (const n of numbering ?? []) {
    if (!Number.isInteger(n) || n < 1 || n >= trimmed.length) continue;
    const overlap = abc.length + n - trimmed.length;
    if (overlap > 0 && overlap < abc.length) {
      positive.push(overlap);
      continue;
    }
    if (overlap < 0 && nationalCode(trimmed, abc, n)) short.push(n);
  }
  if (positive.length === 1) {
    const display = abc.slice(0, abc.length - positive[0]!);
    return { abc: display, telephone: trimmed.slice(display.length) };
  }
  if (positive.length === 0 && short.length === 1) {
    const n = short[0]!;
    return {
      abc: trimmed.slice(1, trimmed.length - n),
      telephone: trimmed.slice(trimmed.length - n),
    };
  }
  return { abc, telephone: trimmed.slice(abc.length) };
}
