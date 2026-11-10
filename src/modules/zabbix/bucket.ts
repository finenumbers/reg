/** One minute of a Zabbix graph. An empty minute stays null, not zero. */

export const ZABBIX_HISTORY_LIMIT = 20_000;
export const ZABBIX_LINE_CAP = 12;

export type ZabbixBucketFn = "min" | "avg" | "max" | "last";

export type ZabbixHistoryPoint = {
  clock: string;
  value: string;
};

/** calc_fnc 7 draws every raw point. A minute chart uses their average. */
export function bucketFn(calc: string): ZabbixBucketFn {
  if (calc === "1") return "min";
  if (calc === "4") return "max";
  if (calc === "9") return "last";
  return "avg";
}

/**
 * `time_till` is inclusive in Zabbix, so the caller stops one second before
 * seriesEnd. A clock that still lands on the next minute is dropped here.
 */
export function bucketHistory(input: {
  points: readonly ZabbixHistoryPoint[];
  originMs: number;
  minutes: number;
  fn: ZabbixBucketFn;
  truncated: boolean;
}): { minutes: (number | null)[] | null; truncated: boolean } {
  const count = Math.max(0, Math.trunc(input.minutes));
  if (input.truncated || count === 0) return { minutes: null, truncated: true };
  const buckets = new Map<number, number[]>();
  const last = new Map<number, { clock: number; order: number; value: number }>();
  input.points.forEach((point, order) => {
    const clock = Number(point.clock);
    const value = Number(point.value);
    if (!Number.isInteger(clock) || !Number.isFinite(value)) return;
    const index = Math.floor((clock * 1000 - input.originMs) / 60_000);
    if (index < 0 || index >= count) return;
    const values = buckets.get(index);
    if (values) values.push(value);
    else buckets.set(index, [value]);
    const previous = last.get(index);
    if (
      !previous ||
      clock > previous.clock ||
      (clock === previous.clock && order > previous.order)
    ) {
      last.set(index, { clock, order, value });
    }
  });
  const minutes: (number | null)[] = Array.from({ length: count }, () => null);
  for (const [index, values] of buckets) {
    if (input.fn === "min") {
      let min = values[0] ?? 0;
      for (const value of values) if (value < min) min = value;
      minutes[index] = min;
    } else if (input.fn === "max") {
      let max = values[0] ?? 0;
      for (const value of values) if (value > max) max = value;
      minutes[index] = max;
    } else if (input.fn === "last") {
      minutes[index] = last.get(index)?.value ?? null;
    } else {
      let sum = 0;
      for (const value of values) sum += value;
      minutes[index] = sum / values.length;
    }
  }
  return { minutes, truncated: false };
}

export function historyPoints(value: unknown): ZabbixHistoryPoint[] {
  if (!Array.isArray(value)) return [];
  const points: ZabbixHistoryPoint[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.clock !== "string" && typeof row.clock !== "number") continue;
    if (typeof row.value !== "string" && typeof row.value !== "number") continue;
    points.push({ clock: String(row.clock), value: String(row.value) });
  }
  return points;
}
