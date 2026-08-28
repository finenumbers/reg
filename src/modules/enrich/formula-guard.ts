const DANGEROUS = new Set(["=", "+", "-", "@"]);

/** Neutralize Excel formula injection in text cells. */
export function guardExcelText(value: string): string {
  if (value.length === 0) return value;
  const first = value[0];
  if (first && DANGEROUS.has(first)) return `'${value}`;
  return value;
}
