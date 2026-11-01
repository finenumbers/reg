import { formatCount } from "@/lib/format-count";

const EMPTY_SLOT = "_";

/** PSTN range segment: 000-00-00. */
export function formatRangeSegment(value: number): string {
  const n = Math.max(0, Math.floor(value));
  const last2 = n % 100;
  const mid2 = Math.floor(n / 100) % 100;
  const first3 = Math.floor(n / 10000);
  return `${String(first3).padStart(3, "0")}-${String(mid2).padStart(2, "0")}-${String(last2).padStart(2, "0")}`;
}

export function formatPhoneMaskHint(value: string): string {
  const slots = value.padEnd(10, EMPTY_SLOT).slice(0, 10).split("");
  const digit = (index: number) => (slots[index] === EMPTY_SLOT ? "X" : slots[index]);
  return `(${digit(0)}${digit(1)}${digit(2)}) ${digit(3)}${digit(4)}${digit(5)}-${digit(6)}${digit(7)}-${digit(8)}${digit(9)}`;
}

export function formatNumberingCount(value: number): string {
  return formatCount(value);
}

export function emptyPhoneMask(): string {
  return EMPTY_SLOT.repeat(10);
}

export function phoneMaskHasDigit(value: string): boolean {
  return /\d/.test(value);
}
