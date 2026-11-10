import { describe, expect, it } from "vitest";
import { nextVatsDelayMs } from "@/modules/vats/cadence";
import { domainStatFields } from "@/modules/vats/card";
import {
  compareDomains,
  compareTelnums,
  formatAssignedNumbers,
  formatRecordRetention,
  formatSpeechMinutes,
  formatSubscribers,
  formatYesNo,
  resolveRef,
} from "@/modules/vats/labels";
import {
  emptyDomain,
  groupAssignedTelnums,
  numbersForDomain,
  parseDomainSnap,
  parseTelnumSnap,
  toDomainSummary,
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
    expect(toDomainTable(domains.rows[0]!, null).subscribers).toBe("—");
    expect(toDomainTable(domains.rows[0]!, null).frozen).toBe("—");
    expect(toDomainTable(domains.rows[0]!, null).numbers).toBe("—");
    expect(toDomainTable(domains.rows[0]!, null).recordDays).toBe("—");

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

  it("shows one number, a plural, or a dash", () => {
    expect(formatAssignedNumbers(null)).toBe("—");
    expect(formatAssignedNumbers([])).toBe("—");
    expect(formatAssignedNumbers(["01"])).toBe("01");
    expect(formatAssignedNumbers(["9", "10"])).toBe("2 номера");
    expect(formatAssignedNumbers(Array.from({ length: 5 }, () => "1"))).toBe("5 номеров");
    expect(formatAssignedNumbers(Array.from({ length: 11 }, () => "1"))).toBe(
      "11 номеров",
    );
    expect(formatAssignedNumbers(Array.from({ length: 21 }, () => "1"))).toBe("21 номер");
    expect(formatAssignedNumbers(Array.from({ length: 10 }, () => "1"))).toBe(
      "10 номеров",
    );
  });

  it("counts only numbers assigned to that domain", () => {
    const telnums = {
      committed: true,
      rows: [
        { telnum: "10", domain: "a.example", isFmc: null, gateways: [] },
        { telnum: "01", domain: "a.example", isFmc: null, gateways: [] },
        { telnum: "9", domain: "other.example", isFmc: null, gateways: [] },
      ],
    };
    const grouped = groupAssignedTelnums(telnums);
    expect(numbersForDomain("a.example", grouped)).toEqual(["01", "10"]);
    expect(formatAssignedNumbers(numbersForDomain("a.example", grouped))).toBe(
      "2 номера",
    );
    expect(formatAssignedNumbers(numbersForDomain("b.example", grouped))).toBe("—");
    expect(groupAssignedTelnums({ committed: false, rows: telnums.rows })).toBeNull();
    expect(groupAssignedTelnums(parseTelnumSnap(["01", "10"]))).toBeNull();
  });

  it("keeps zero days and minutes and drops a bad statistics field", () => {
    const fields = domainStatFields({
      recordExpirationDays: 0,
      speechAnalytics: { thisMonth: 0, total: 4 },
      activeCRM: ["crm"],
      telnumsCount: 9,
      services: ["autocaller"],
      accessURL: "https://secret.example/login",
      link: "https://domain.pbx.com/api/login?session=secret",
      route: "rt",
    });
    expect(fields).toEqual({ recordDays: 0, speechMinutes: 0 });
    expect(JSON.stringify(fields)).not.toContain("activeCRM");
    expect(JSON.stringify(fields)).not.toContain("telnumsCount");
    expect(JSON.stringify(fields)).not.toContain("accessURL");
    expect(JSON.stringify(fields)).not.toContain("route");
    expect(
      domainStatFields({
        recordExpirationDays: -1,
        speechAnalytics: { thisMonth: 1.5 },
      }),
    ).toEqual({ recordDays: null, speechMinutes: null });
    expect(domainStatFields({ speechAnalytics: {} })).toEqual({
      recordDays: null,
      speechMinutes: null,
    });

    const stored = parseDomainSnap({
      v: 2,
      committed: true,
      rows: [
        {
          ...emptyDomain("a.example"),
          recordDays: 0,
          speechMinutes: 0,
          extDigits: 4,
          billingType: "billable",
          language: "ru-RU",
          services: ["autocaller"],
          activeCRM: ["crm"],
          telnumsCount: 9,
          accessURL: "https://secret.example/login",
          link: "https://domain.pbx.com/api/login?session=secret",
          route: "rt",
        },
      ],
    });
    const row = stored.rows[0]!;
    expect(row.recordDays).toBe(0);
    expect(JSON.stringify(row)).not.toContain("session=secret");
    expect(row.speechMinutes).toBe(0);
    expect(toDomainTable(row, []).recordDays).toBe("0 дней");
    expect(toDomainTable(row, []).speechMinutes).toBe("—");
    const summary = toDomainSummary(row, null);
    expect(summary.recordDays).toBe("0 дней");
    expect(summary.speechMinutes).toBe("—");
    expect(summary.numbers).toBeNull();
    expect(summary.billing).toBe("Платный");
    const packed = JSON.stringify(summary);
    expect(packed).not.toContain("services");
    expect(packed).not.toContain("activeCRM");
    expect(packed).not.toContain("telnumsCount");
    expect(packed).not.toContain("accessURL");
    expect(packed).not.toContain("route");
    expect(Object.keys(summary)).not.toContain("route");
  });

  it("names speech minutes and hides zero", () => {
    const gap = "\u202F";
    expect(formatSpeechMinutes(null)).toBe("—");
    expect(formatSpeechMinutes(0)).toBe("—");
    expect(formatSpeechMinutes(1)).toBe("1 минута");
    expect(formatSpeechMinutes(2)).toBe("2 минуты");
    expect(formatSpeechMinutes(11)).toBe("11 минут");
    expect(formatSpeechMinutes(12)).toBe("12 минут");
    expect(formatSpeechMinutes(21)).toBe("21 минута");
    expect(formatSpeechMinutes(22)).toBe("22 минуты");
    expect(formatSpeechMinutes(46)).toBe("46 минут");
    expect(formatSpeechMinutes(1012)).toBe(`1${gap}012 минут`);
    expect(formatSpeechMinutes(1052)).toBe(`1${gap}052 минуты`);
  });

  it("names a recording period and keeps an unlisted count", () => {
    expect(formatRecordRetention(91)).toBe("3 месяца");
    expect(formatRecordRetention(93)).toBe("3 месяца");
    expect(formatRecordRetention(31)).toBe("1 месяц");
    expect(formatRecordRetention(181)).toBe("6 месяцев");
    expect(formatRecordRetention(14)).toBe("2 недели");
    expect(formatRecordRetention(7300)).toBe("Неограниченно");
    expect(formatRecordRetention(0)).toBe("0 дней");
    expect(formatRecordRetention(1)).toBe("1 день");
    expect(formatRecordRetention(2)).toBe("2 дня");
    expect(formatRecordRetention(5)).toBe("5 дней");
    expect(formatRecordRetention(11)).toBe("11 дней");
    expect(formatRecordRetention(21)).toBe("3 недели");
    expect(formatRecordRetention(41)).toBe("41 день");
    expect(formatRecordRetention(22)).toBe("22 дня");
    expect(formatRecordRetention(30)).toBe("30 дней");
    expect(formatRecordRetention(null)).toBe("—");
    expect(formatRecordRetention(1.5)).toBe("—");
    expect(formatRecordRetention(-1)).toBe("—");
  });

  it("waits 120 seconds unless settings asked for a restart", () => {
    expect(nextVatsDelayMs(false)).toBe(120_000);
    expect(nextVatsDelayMs(true)).toBe(0);
  });
});
