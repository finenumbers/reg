import { guardExcelText } from "@/modules/enrich/formula-guard";

const DIGITS_UP_TO_15 = /^\d{1,15}$/;

/** Excel number when the phone is 1–15 digits; otherwise guarded text. */
export function excelPhoneValue(raw: string): string | number {
  const trimmed = raw.trim();
  if (DIGITS_UP_TO_15.test(trimmed)) return Number(trimmed);
  return guardExcelText(raw);
}
