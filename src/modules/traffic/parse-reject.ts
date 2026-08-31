import { formatCount } from "@/lib/format-count";
import type { CdrParseReject } from "@/modules/traffic/parse-cdr";

export type ParseRejectCounts = Record<CdrParseReject, number>;

export function emptyParseRejectCounts(): ParseRejectCounts {
  return { width: 0, cdr_id: 0, date: 0 };
}

export function formatParseRejectCounts(counts: ParseRejectCounts): string {
  const parts: string[] = [];
  if (counts.date > 0) parts.push(`${formatCount(counts.date)} без даты`);
  if (counts.cdr_id > 0) parts.push(`${formatCount(counts.cdr_id)} без cdr_id`);
  if (counts.width > 0) {
    parts.push(`${formatCount(counts.width)} с неверным числом полей`);
  }
  return parts.join(", ");
}
