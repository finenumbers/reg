import { describe, expect, it } from "vitest";
import { formatCount } from "@/lib/format-count";
import { overlayDashboardFigures } from "@/modules/dashboard/overlay";
import { MONTH_CALLS_UNAVAILABLE } from "@/modules/dashboard/month-prefix";
import type { DashboardCard, DashboardSnapshot } from "@/modules/dashboard/types";
import { CDR_VACUUM_BUSY_MESSAGE } from "@/modules/storage/vacuum/gate";

function card(
  id: string,
  stats: DashboardCard["stats"],
  note: string | null,
): DashboardCard {
  return {
    id,
    title: id,
    href: "/",
    badge: "ok",
    badgeLabel: "ok",
    successAt: null,
    load: null,
    packetAt: null,
    emptyAge: null,
    stats,
    note,
  };
}

function snapshot(): DashboardSnapshot {
  return {
    alerts: [],
    calls: true,
    antifraudNodes: [],
    cards: [
      card(
        "traffic",
        [
          { label: "Звонки, этот месяц", value: "…" },
          { label: "Минуты, этот месяц", value: "…" },
        ],
        `Возраст загрузки недоступен. ${CDR_VACUUM_BUSY_MESSAGE}`,
      ),
      card(
        "smg",
        [
          { label: "Звонки, этот месяц", value: "…" },
          { label: "Минуты, этот месяц", value: "…" },
        ],
        null,
      ),
      card(
        "syslog",
        [
          { label: "Объём данных", value: "…" },
          { label: "События Антифрод", value: "…" },
        ],
        null,
      ),
    ],
  };
}

describe("overlayDashboardFigures", () => {
  it("replaces the live figures on a copy", () => {
    const source = snapshot();
    const trafficCalls = source.cards[0]?.stats[0];
    const next = overlayDashboardFigures(source, {
      trafficCalls: 1200,
      trafficNote: null,
      smgCalls: 7,
      smgMinutes: null,
      antifraudEvents: 0,
    });

    expect(source.cards[0]?.stats[0]?.value).toBe("…");
    expect(source.cards[0]?.stats[1]?.value).toBe("…");
    expect(trafficCalls).toBe(source.cards[0]?.stats[0]);
    expect(next).not.toBe(source);
    expect(next.cards[0]).not.toBe(source.cards[0]);
    expect(next.cards[0]?.stats).not.toBe(source.cards[0]?.stats);

    expect(next.cards[0]?.stats[0]?.value).toBe(formatCount(1200));
    expect(next.cards[0]?.stats[1]?.value).toBe("…");
    expect(next.cards[0]?.note).toBe("Возраст загрузки недоступен.");
    expect(next.cards[1]?.stats[0]?.value).toBe(formatCount(7));
    expect(next.cards[1]?.stats[1]?.value).toBe("…");
    expect(next.cards[2]?.stats[0]?.value).toBe("…");
    expect(next.cards[2]?.stats[1]?.value).toBe("0");
  });

  it("adds the reader gap without dropping the load age or repeating it", () => {
    const source = snapshot();
    source.cards[0] = {
      ...source.cards[0]!,
      note: `Возраст загрузки недоступен. ${MONTH_CALLS_UNAVAILABLE}`,
    };
    const next = overlayDashboardFigures(source, {
      trafficCalls: null,
      trafficNote: CDR_VACUUM_BUSY_MESSAGE,
      smgCalls: null,
      smgMinutes: 4,
      antifraudEvents: null,
    });
    expect(next.cards[0]?.note).toBe(
      `Возраст загрузки недоступен. ${CDR_VACUUM_BUSY_MESSAGE}`,
    );
    expect(next.cards[0]?.stats[0]?.value).toBe("…");
    expect(next.cards[1]?.stats[1]?.value).toBe(formatCount(4));
    expect(next.cards[2]?.stats[1]?.value).toBe("…");

    const again = overlayDashboardFigures(next, {
      trafficCalls: null,
      trafficNote: CDR_VACUUM_BUSY_MESSAGE,
      smgCalls: null,
      smgMinutes: 4,
      antifraudEvents: null,
    });
    expect(again.cards[0]?.note).toBe(
      `Возраст загрузки недоступен. ${CDR_VACUUM_BUSY_MESSAGE}`,
    );
  });

  it("keeps the job-status sentence when the count arrives", () => {
    const source = snapshot();
    source.cards[0] = {
      ...source.cards[0]!,
      note: `Статус задач недоступен. ${MONTH_CALLS_UNAVAILABLE}`,
    };
    const next = overlayDashboardFigures(source, {
      trafficCalls: 3,
      trafficNote: null,
      smgCalls: null,
      smgMinutes: null,
      antifraudEvents: null,
    });
    expect(next.cards[0]?.note).toBe("Статус задач недоступен.");
    expect(next.cards[0]?.stats[0]?.value).toBe(formatCount(3));
  });
});
