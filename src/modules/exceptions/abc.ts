/** Digit ABC for «Исключения». The numeric branch of the tariff parser is not used. */
export function parseDialExceptionAbc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!/^\d{1,15}$/.test(text)) return null;
  return text;
}

export const DIAL_EXCEPTION_ABC_ERROR = "ABC — только цифры, от 1 до 15 знаков";
