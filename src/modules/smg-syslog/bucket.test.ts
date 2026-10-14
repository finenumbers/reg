import { describe, expect, it } from "vitest";
import { bucketOf } from "@/modules/smg-syslog/bucket";

describe("syslog buckets", () => {
  it("maps minutes onto 10-minute slots", () => {
    expect(bucketOf(new Date("2026-10-14T19:09:00Z"), 0).slot).toBe("00");
    expect(bucketOf(new Date("2026-10-14T19:10:00Z"), 0).slot).toBe("10");
    expect(bucketOf(new Date("2026-10-14T19:59:00Z"), 0).slot).toBe("50");
  });

  it("rolls the civil day in Moscow and Novosibirsk", () => {
    const moscow = bucketOf(new Date("2026-10-14T21:00:00Z"), 3);
    expect(moscow).toMatchObject({ year: "2026", month: "10", day: "15", hour: "00", slot: "00" });
    const novosibirsk = bucketOf(new Date("2026-10-14T17:09:00Z"), 7);
    expect(novosibirsk).toMatchObject({
      year: "2026",
      month: "10",
      day: "15",
      hour: "00",
      slot: "00",
    });
  });

  it("keeps 22:50 in Moscow for a 19:50 UTC arrival", () => {
    expect(bucketOf(new Date("2026-10-14T19:50:00Z"), 3)).toMatchObject({
      day: "14",
      hour: "22",
      slot: "50",
    });
  });
});
