/**
 * Screen split after the tariff row is already chosen.
 * Strips a suffix of the tariff ABC only when exactly one numbering
 * value says those digits belong to the local number.
 * The SQL function geography_digit_split repeats this rule.
 */

export type CityDigitSplit = {
  abc: string;
  telephone: string;
};

export function cityDigitSplit(
  number: string,
  tariffAbc: string | null | undefined,
  numbering: readonly number[] | null | undefined,
): CityDigitSplit {
  const abc = tariffAbc ?? "";
  if (!abc) return { abc: "", telephone: "" };
  const trimmed = number.trim();
  if (!trimmed.startsWith(abc)) return { abc, telephone: "" };
  const overlaps: number[] = [];
  for (const n of numbering ?? []) {
    if (!Number.isInteger(n) || n < 1 || n >= trimmed.length) continue;
    const overlap = abc.length + n - trimmed.length;
    if (overlap > 0 && overlap < abc.length) overlaps.push(overlap);
  }
  if (overlaps.length === 1) {
    const display = abc.slice(0, abc.length - overlaps[0]!);
    return { abc: display, telephone: trimmed.slice(display.length) };
  }
  return { abc, telephone: trimmed.slice(abc.length) };
}
