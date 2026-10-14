import { formatCount } from "@/lib/format-count";

const UNITS = ["Б", "КБ", "МБ", "ГБ", "ТБ"] as const;

export type ByteParts = {
  value: string;
  unit: string;
};

/** Binary units (1024). The integer part uses the same grouping as other counts. */
export function formatByteParts(n: number): ByteParts {
  if (!Number.isFinite(n) || n <= 0) return { value: "0", unit: "Б" };
  let value = n;
  let i = 0;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  const digits = value >= 10 || i === 0 ? 0 : 1;
  const text = value.toFixed(digits);
  const [whole = "0", frac] = text.split(".");
  const grouped = formatCount(Number(whole));
  return {
    value: frac === undefined ? grouped : `${grouped}.${frac}`,
    unit: UNITS[i] ?? "Б",
  };
}

export function formatBytes(n: number): string {
  const { value, unit } = formatByteParts(n);
  return `${value} ${unit}`;
}
