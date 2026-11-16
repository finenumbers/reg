/**
 * Text drawn before the tariff pair. Null means the pair already rebuilds the number.
 * A stored e164 with an empty pair is shown in «Номер». ABC stays empty.
 */

export type CatalogDigitColumn = "abc" | "number";

export function catalogDigitPlain(
  column: CatalogDigitColumn,
  e164: string,
  abc: string,
  number: string,
): string | null {
  if (!e164) return column === "abc" ? abc : number;
  if (!abc && !number) return column === "number" ? e164 : "";
  return null;
}
