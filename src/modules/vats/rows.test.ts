import { describe, expect, it } from "vitest";
import { nextVatsDelayMs } from "@/modules/vats/cadence";
import {
  compareDomains,
  compareTelnums,
  formatSubscribers,
  formatYesNo,
  resolveRef,
} from "@/modules/vats/labels";
import {
  parseDomainSnap,
  parseTelnumSnap,
  toDomainTable,
  toTelnumTable,
  visibleReadAt,
} from "@/modules/vats/rows";

describe("VATS row snapshot", () => {
  it("treats a legacy name list as uncommitted", () => {
    const domains = parseDomainSnap(["b.example", "a.example"]);
    expect(domains.committed).toBe(false);
    expect(domains.rows.map((row) => row.name)).toEqual(["b.example", "a.example"]);
    expect(
      visibleReadAt(domains.committed, new Date("2026-11-09T00:00:00.000Z")),
    ).toBeNull();
    expect(toDomainTable(domains.rows[0]!).subscribers).toBe("—");
    expect(toDomainTable(domains.rows[0]!).frozen).toBe("—");

    const telnums = parseTelnumSnap(["10", "9"]);
    expect(telnums.committed).toBe(false);
    expect(toTelnumTable(telnums.rows[0]!).gateways).toBe("—");
  });

  it("formats subscribers and keeps zero", () => {
    expect(formatSubscribers(0, 4)).toBe("0 / 4");
    expect(formatSubscribers(1, -1)).toBe("1 / без лимита");
    expect(formatSubscribers(1, -2)).toBe("—");
    expect(formatSubscribers(null, 4)).toBe("—");
    expect(formatYesNo(null)).toBe("—");
    expect(formatYesNo(false)).toBe("Нет");
  });

  it("sorts domains by Russian locale and numbers by value", () => {
    expect(compareDomains("b.example", "a.example")).toBeGreaterThan(0);
    expect(["10", "9", "10"].sort(compareTelnums)).toEqual(["9", "10", "10"]);
    expect(compareTelnums("01", "1")).toBeLessThan(0);
  });

  it("lets a gateway id win over another gateway's name", () => {
    const catalog = [
      { id: "gw-1", name: "North" },
      { id: "gw-2", name: "gw-1" },
    ];
    expect(resolveRef("gw-1", catalog)).toBe("North");
    expect(resolveRef("gw-2", catalog)).toBe("gw-1");
    expect(resolveRef("missing", catalog)).toBeNull();
  });

  it("waits 120 seconds unless settings asked for a restart", () => {
    expect(nextVatsDelayMs(false)).toBe(120_000);
    expect(nextVatsDelayMs(true)).toBe(0);
  });
});
