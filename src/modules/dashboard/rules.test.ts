import { afterEach, describe, expect, it } from "vitest";
import { formatCount } from "@/lib/format-count";
import { purgeHoldMessage } from "@/modules/traffic/poison";
import {
  resetPurgeTargetForTests,
  setPurgeTargetMonth,
} from "@/modules/traffic/purge/target";
import { CDR_VACUUM_BUSY_MESSAGE } from "@/modules/storage/vacuum/gate";
import {
  buildDashboard,
  cachedMonthCalls,
  clipError,
  exportStaleAfterMs,
  isDashboardPoison,
  regsStaleAfterMs,
  type DashboardFacts,
  type ImportPulse,
  type ScheduledPulse,
  type SyslogPulse,
} from "@/modules/dashboard/rules";

const NOW = Date.parse("2026-10-16T00:00:00.000Z");

afterEach(() => {
  resetPurgeTargetForTests();
});

function pulse(over: Partial<ScheduledPulse> = {}): ScheduledPulse {
  return {
    enabled: true,
    running: false,
    lastStatus: "success",
    lastSuccessAt: NOW - 30_000,
    lastError: null,
    ...over,
  };
}

function imported(over: Partial<ImportPulse> = {}): ImportPulse {
  return {
    running: false,
    lastStatus: "success",
    lastError: null,
    pendingReady: 0,
    poisonCount: 0,
    poisonLabel: null,
    loadKnown: true,
    lastPassAt: NOW - 60_000,
    hadCalls: true,
    lastCheckedAt: null,
    ...over,
  };
}

function syslog(over: Partial<SyslogPulse> = {}): SyslogPulse {
  return {
    enabled: true,
    filePresent: true,
    updatedAt: NOW - 1000,
    listening: true,
    bindError: null,
    lowSpace: false,
    freeBytes: 5 * 1024 * 1024 * 1024,
    unknownTotal: 0,
    lastPacketAt: NOW - 2000,
    ...over,
  };
}

function facts(over: Partial<DashboardFacts> = {}): DashboardFacts {
  return {
    now: NOW,
    regsIntervalSec: 60,
    exportIntervalSec: 300,
    jobsOk: true,
    regs: null,
    phones: null,
    groups: null,
    traffic: null,
    smg: null,
    syslog: null,
    vacuumActive: false,
    purgeActive: false,
    showMaintenance: false,
    ...over,
  };
}

function ids(view: ReturnType<typeof buildDashboard>): string[] {
  return view.alerts.map((alert) => alert.id);
}

describe("dashboard attention", () => {
  it("keeps a switched-off poll off the strip", () => {
    const view = buildDashboard(
      facts({
        regs: {
          ...pulse({
            enabled: false,
            lastStatus: "failed",
            lastError: "SSH timeout",
            lastSuccessAt: null,
          }),
          registered: 1,
          unregistered: 2,
          total: 3,
        },
      }),
    );
    expect(view.alerts).toEqual([]);
    expect(view.cards[0]?.badge).toBe("off");
    expect(view.cards[0]?.stats.map((stat) => stat.value)).toEqual(["1", "2"]);
  });

  it("reports a failed poll and does not also call it stale", () => {
    const view = buildDashboard(
      facts({
        regs: {
          ...pulse({
            lastStatus: "failed",
            lastError: "SSH timeout",
            lastSuccessAt: NOW - 24 * 60 * 60 * 1000,
          }),
          registered: 4,
          unregistered: 1,
          total: 5,
        },
      }),
    );
    expect(ids(view)).toEqual(["regs-failed"]);
    expect(view.alerts[0]?.text).toBe("Опрос регистраций не прошёл: SSH timeout");
    expect(view.alerts[0]?.href).toBe("/regs");
    expect(view.cards[0]?.badge).toBe("failed");
  });

  it("hides staleness while the poll is running, and still shows the last failure", () => {
    const running = buildDashboard(
      facts({
        regs: {
          ...pulse({ running: true, lastSuccessAt: NOW - 24 * 60 * 60 * 1000 }),
          registered: 0,
          unregistered: 0,
          total: 0,
        },
      }),
    );
    expect(running.alerts).toEqual([]);
    expect(running.cards[0]?.badge).toBe("running");

    const failedWhileRunning = buildDashboard(
      facts({
        regs: {
          ...pulse({
            running: true,
            lastStatus: "failed",
            lastError: "пустой stdout",
            lastSuccessAt: NOW - 24 * 60 * 60 * 1000,
          }),
          registered: 0,
          unregistered: 0,
          total: 0,
        },
      }),
    );
    expect(ids(failedWhileRunning)).toEqual(["regs-failed"]);
    expect(failedWhileRunning.cards[0]?.badge).toBe("running");
  });

  it("uses a two-minute floor when the poll interval is short", () => {
    expect(regsStaleAfterMs(30)).toBe(2 * 60 * 1000);
    const fresh = buildDashboard(
      facts({
        regsIntervalSec: 30,
        regs: {
          ...pulse({ lastSuccessAt: NOW - 2 * 60 * 1000 }),
          registered: 1,
          unregistered: 0,
          total: 1,
        },
      }),
    );
    expect(fresh.alerts).toEqual([]);

    const stale = buildDashboard(
      facts({
        regsIntervalSec: 30,
        regs: {
          ...pulse({ lastSuccessAt: NOW - 2 * 60 * 1000 - 1 }),
          registered: 1,
          unregistered: 0,
          total: 1,
        },
      }),
    );
    expect(ids(stale)).toEqual(["regs-stale"]);
    expect(stale.cards[0]?.badge).toBe("failed");
  });

  it("waits two missed export turns before calling phones or groups stale", () => {
    expect(exportStaleAfterMs(300)).toBe(20 * 60 * 1000);
    expect(exportStaleAfterMs(30)).toBe(10 * 60 * 1000);

    const phones = {
      ...pulse({ lastSuccessAt: NOW - 19 * 60 * 1000 }),
      endpointCount: 10,
      gatewayCount: 2,
    };
    const almost = buildDashboard(facts({ phones }));
    expect(almost.alerts).toEqual([]);

    const late = buildDashboard(
      facts({
        phones: { ...phones, lastSuccessAt: NOW - 20 * 60 * 1000 - 1 },
      }),
    );
    expect(ids(late)).toEqual(["phones-stale"]);

    const shortInterval = buildDashboard(
      facts({
        exportIntervalSec: 30,
        groups: pulse({ lastSuccessAt: NOW - 9 * 60 * 1000 }),
      }),
    );
    expect(shortInterval.alerts).toEqual([]);
    expect(shortInterval.cards).toEqual([]);
  });

  it("keeps a groups failure on the strip and off the cards", () => {
    const view = buildDashboard(
      facts({
        groups: pulse({
          lastStatus: "failed",
          lastError: "export.py",
          lastSuccessAt: NOW - 60_000,
        }),
      }),
    );
    expect(ids(view)).toEqual(["groups-failed"]);
    expect(view.alerts[0]?.href).toBe("/groups");
    expect(view.cards).toEqual([]);
  });

  it("alerts when an enabled loop has never succeeded", () => {
    const view = buildDashboard(
      facts({
        regs: {
          ...pulse({ lastStatus: "never", lastSuccessAt: null }),
          registered: null,
          unregistered: null,
          total: null,
        },
      }),
    );
    expect(ids(view)).toEqual(["regs-never"]);
    expect(view.cards[0]?.badge).toBe("empty");
    expect(view.cards[0]?.stats[0]?.value).toBe("…");
  });

  it("does not treat a purge hold as poison, and links a real poison file to raw CDR", () => {
    setPurgeTargetMonth("2026-09");
    expect(isDashboardPoison(purgeHoldMessage("2026-09"), true)).toBe(false);
    expect(isDashboardPoison(purgeHoldMessage("2026-08"), true)).toBe(true);
    expect(isDashboardPoison("битая строка", false)).toBe(true);

    const held = buildDashboard(
      facts({
        showMaintenance: true,
        traffic: {
          ...imported(),
          poisonCount: 0,
          monthCalls: 12,
          monthMinutes: 40,
          monthNote: null,
        },
      }),
    );
    expect(held.alerts).toEqual([]);
    expect(held.cards[0]?.stats[0]?.value).toBe("12");

    const poison = buildDashboard(
      facts({
        traffic: {
          ...imported(),
          poisonCount: 2,
          poisonLabel: "20261015_120000: битая строка",
          monthCalls: 0,
          monthMinutes: 0,
          monthNote: null,
        },
      }),
    );
    expect(ids(poison)).toEqual(["traffic-poison"]);
    expect(poison.alerts[0]?.href).toBe("/raw");
    expect(poison.alerts[0]?.text).toContain("2 файлов отложены");
    expect(poison.alerts[0]?.text).toContain("Сырые данные");
    expect(poison.cards[0]?.badge).toBe("failed");
    expect(poison.cards[0]?.stats.map((stat) => stat.label)).toEqual([
      "Звонки, этот месяц",
      "Минуты, этот месяц",
    ]);
    expect(poison.cards[0]?.stats[0]?.value).toBe("0");
    expect(poison.cards[0]?.stats[1]?.value).toBe("0");
  });

  it("warns about a waiting inbox from the second ready file, not while import is running", () => {
    const one = buildDashboard(
      facts({
        smg: imported({ pendingReady: 1 }),
      }),
    );
    expect(one.alerts).toEqual([]);

    const two = buildDashboard(
      facts({
        traffic: {
          ...imported({ pendingReady: 2 }),
          monthCalls: 3,
          monthMinutes: 3,
          monthNote: null,
        },
      }),
    );
    expect(ids(two)).toEqual(["traffic-inbox"]);
    expect(two.alerts[0]?.href).toBe("/traffic");

    const running = buildDashboard(
      facts({
        traffic: {
          ...imported({ pendingReady: 4, running: true }),
          monthCalls: 3,
          monthMinutes: 3,
          monthNote: null,
        },
      }),
    );
    expect(running.alerts).toEqual([]);
    expect(running.cards[0]?.badge).toBe("running");
  });

  it("does not draw zero calls while the month count is unknown", () => {
    expect(cachedMonthCalls(null, "2026-10")).toBeNull();
    expect(cachedMonthCalls([{ key: "2026-09", count: 4 }], "2026-10")).toBeNull();
    expect(cachedMonthCalls([{ key: "2026-10", count: 0 }], "2026-10")).toBe(0);

    const view = buildDashboard(
      facts({
        showMaintenance: true,
        vacuumActive: true,
        purgeActive: true,
        traffic: {
          ...imported(),
          monthCalls: null,
          monthMinutes: null,
          monthNote: CDR_VACUUM_BUSY_MESSAGE,
        },
      }),
    );
    expect(view.cards[0]?.stats[0]?.value).toBe("…");
    expect(view.cards[0]?.stats[1]?.value).toBe("…");
    expect(view.cards[0]?.note).toBe(CDR_VACUUM_BUSY_MESSAGE);
    expect(view.alerts.map((alert) => alert.tone)).toEqual(["info", "info"]);
    expect(view.alerts[0]?.href).toBeNull();
  });

  it("keeps maintenance off the screen without phones access", () => {
    const view = buildDashboard(
      facts({
        showMaintenance: false,
        vacuumActive: true,
        regs: {
          ...pulse(),
          registered: 1,
          unregistered: 0,
          total: 1,
        },
      }),
    );
    expect(view.alerts).toEqual([]);
    expect(view.cards.map((card) => card.id)).toEqual(["registrations"]);
    expect(view.cards[0]?.stats.map((stat) => stat.label)).toEqual([
      "Зарегистрировано",
      "Не зарегистрировано",
    ]);
  });

  it("keeps the call count when this month's minutes are still unknown", () => {
    const view = buildDashboard(
      facts({
        traffic: {
          ...imported(),
          monthCalls: 9,
          monthMinutes: null,
          monthNote: null,
        },
      }),
    );
    expect(view.cards[0]?.stats[0]?.value).toBe("9");
    expect(view.cards[0]?.stats[1]?.value).toBe("…");
    expect(view.cards[0]?.badge).toBe("ok");
    expect(view.alerts).toEqual([]);
  });

  it("formats this month's minutes without touching the inbox rows", () => {
    const view = buildDashboard(
      facts({
        traffic: {
          ...imported(),
          monthCalls: 9,
          monthMinutes: 1200,
          monthNote: null,
        },
      }),
    );
    expect(view.cards[0]?.stats[1]).toEqual({
      label: "Минуты, этот месяц",
      value: formatCount(1200),
    });
  });

  it("alerts when syslog reception is on and the receiver is quiet or deaf", () => {
    const off = buildDashboard(
      facts({
        syslog: syslog({
          enabled: false,
          updatedAt: NOW - 10 * 60 * 1000,
          listening: false,
        }),
      }),
    );
    expect(off.alerts).toEqual([]);
    expect(off.cards[0]?.badge).toBe("off");

    const missing = buildDashboard(
      facts({
        syslog: syslog({ filePresent: false, updatedAt: null }),
      }),
    );
    expect(ids(missing)).toEqual(["syslog-missing"]);

    const stale = buildDashboard(
      facts({
        syslog: syslog({
          updatedAt: NOW - 31_000,
          listening: false,
          bindError: "EADDRINUSE",
        }),
      }),
    );
    expect(ids(stale)).toEqual(["syslog-stale"]);

    const deaf = buildDashboard(
      facts({
        syslog: syslog({ listening: false, lowSpace: true, unknownTotal: 3 }),
      }),
    );
    expect(ids(deaf)).toEqual(["syslog-listen", "syslog-space", "syslog-unknown"]);
    expect(deaf.cards[0]?.badge).toBe("failed");
    expect(deaf.cards[0]?.href).toBe("/smg/syslog");
  });

  it("clips a long job error", () => {
    const error = "x".repeat(400);
    expect(clipError(error).length).toBe(180);
    expect(clipError("  ")).toBe("без текста ошибки");
  });

  it("says the job read failed without inventing a missed poll", () => {
    const view = buildDashboard(
      facts({
        jobsOk: false,
        regs: {
          ...pulse({ enabled: true, lastStatus: "never", lastSuccessAt: null }),
          registered: 8,
          unregistered: 1,
          total: 9,
        },
      }),
    );
    expect(ids(view)).toEqual(["jobs"]);
    expect(view.cards[0]?.badge).toBe("failed");
    expect(view.cards[0]?.note).toBe("Статус задач недоступен.");
    expect(view.cards[0]?.emptyAge).toBeNull();
  });
});
