import { formatCount } from "@/lib/format-count";

const GIB = 1024 ** 3;

/** Whole project database size, always in GiB with one decimal and a `Gb` suffix. */
export function formatDatabaseGigabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0,0 Gb";
  const [whole, frac] = (bytes / GIB).toFixed(1).split(".");
  return `${formatCount(Number(whole))},${frac} Gb`;
}
