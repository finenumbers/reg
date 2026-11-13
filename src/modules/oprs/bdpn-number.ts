/** OPRS stores a mobile RF number as 79 and nine more digits. The form wants the ten without the 7. */
export function bdpnNumberFromBillDnis(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^79\d{9}$/.test(trimmed)) return null;
  return trimmed.slice(1);
}
