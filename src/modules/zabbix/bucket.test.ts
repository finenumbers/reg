import { describe, expect, it } from "vitest";
import { TWO_HOUR_MINUTES } from "@/modules/dashboard/concurrency";
import { bucketFn, bucketHistory, ZABBIX_HISTORY_LIMIT } from "@/modules/zabbix/bucket";
import { formatZabbixNumber, zabbixScale, zabbixStroke } from "@/modules/zabbix/scale";

const MINUTE = 60_000;

describe("Zabbix minute buckets", () => {
  const originMs = Date.UTC(2026, 10, 11, 1, 1, 0);

  it("keeps a real zero and leaves an empty minute empty", () => {
    const bucket = bucketHistory({
      points: [
        { clock: String(originMs / 1000), value: "0" },
        { clock: String(originMs / 1000 + 60), value: "1.5" },
      ],
      originMs,
      minutes: TWO_HOUR_MINUTES,
      fn: "avg",
      truncated: false,
    });
    expect(bucket.truncated).toBe(false);
    expect(bucket.minutes?.[0]).toBe(0);
    expect(bucket.minutes?.[1]).toBe(1.5);
    expect(bucket.minutes?.[2]).toBeNull();
    expect(bucket.minutes).toHaveLength(120);
  });

  it("drops a point that lands on the end of the window", () => {
    const end = originMs + TWO_HOUR_MINUTES * MINUTE;
    const bucket = bucketHistory({
      points: [
        { clock: String(end / 1000), value: "9" },
        { clock: String(end / 1000 - 1), value: "-2" },
      ],
      originMs,
      minutes: TWO_HOUR_MINUTES,
      fn: bucketFn("4"),
      truncated: false,
    });
    expect(bucket.minutes?.[119]).toBe(-2);
    expect(bucket.minutes?.some((value) => value === 9)).toBe(false);
  });

  it("does not draw a row that hit the history limit", () => {
    const bucket = bucketHistory({
      points: [{ clock: String(originMs / 1000), value: "1" }],
      originMs,
      minutes: TWO_HOUR_MINUTES,
      fn: "avg",
      truncated: true,
    });
    expect(bucket.minutes).toBeNull();
    expect(ZABBIX_HISTORY_LIMIT).toBe(20_000);
  });

  it("averages every point in a minute when the graph asks for all of them", () => {
    expect(bucketFn("7")).toBe("avg");
    const bucket = bucketHistory({
      points: [
        { clock: String(originMs / 1000), value: "1" },
        { clock: String(originMs / 1000 + 10), value: "3" },
      ],
      originMs,
      minutes: 120,
      fn: bucketFn("7"),
      truncated: false,
    });
    expect(bucket.minutes?.[0]).toBe(2);
  });
});

describe("Zabbix scale", () => {
  it("keeps a fraction above zero and a negative sample", () => {
    const small = zabbixScale([0.037]);
    expect(small.min).toBe(0);
    expect(small.max).toBeGreaterThanOrEqual(0.037);
    expect(small.max).toBeLessThan(1);
    const signed = zabbixScale([-2, 4]);
    expect(signed.min).toBeLessThan(0);
    expect(signed.max).toBeGreaterThanOrEqual(4);
  });

  it("formats a stored value without turning a percent into a prefix", () => {
    expect(formatZabbixNumber(0.037)).toBe("0.04");
    expect(formatZabbixNumber(1500)).toBe("1.5k");
    expect(zabbixStroke("00C800")).toBe("#00C800");
    expect(zabbixStroke("red")).toBe("#64748b");
    expect(zabbixStroke("#abc")).toBe("#64748b");
  });
});
