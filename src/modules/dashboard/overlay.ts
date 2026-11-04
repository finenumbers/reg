import { formatCount } from "@/lib/format-count";
import { MONTH_CALLS_UNAVAILABLE } from "@/modules/dashboard/month-prefix";
import type { DashboardSnapshot } from "@/modules/dashboard/types";
import { CDR_VACUUM_BUSY_MESSAGE } from "@/modules/storage/vacuum/gate";

const GAP = "…";
const TRAFFIC_CALLS = "Звонки, этот месяц";
const SMG_CALLS = "Звонки, этот месяц";
const SMG_MINUTES = "Минуты, этот месяц";
const ANTIFRAUD_EVENTS = "События Антифрод";

const GAP_NOTES = [MONTH_CALLS_UNAVAILABLE, CDR_VACUUM_BUSY_MESSAGE];

export type DashboardFigurePatch = {
  trafficCalls: number | null;
  trafficNote: string | null;
  smgCalls: number | null;
  smgMinutes: number | null;
  antifraudEvents: number | null;
};

function countText(value: number | null): string {
  if (value == null) return GAP;
  return formatCount(value);
}

function stripGapNotes(note: string | null): string | null {
  if (!note) return null;
  let text = note;
  for (const phrase of GAP_NOTES) text = text.split(phrase).join(" ");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

function trafficNote(
  existing: string | null,
  calls: number | null,
  readerNote: string | null,
): string | null {
  const kept = stripGapNotes(existing);
  if (calls != null) return kept;
  if (!readerNote) return kept;
  if (kept?.includes(readerNote)) return kept;
  return kept ? `${kept} ${readerNote}` : readerNote;
}

function replaceStat(
  stats: DashboardSnapshot["cards"][number]["stats"],
  label: string,
  value: string,
): DashboardSnapshot["cards"][number]["stats"] {
  return stats.map((stat) => (stat.label === label ? { ...stat, value } : stat));
}

/** Copy the snapshot and replace the live figures. The cached object stays as it was. */
export function overlayDashboardFigures(
  snapshot: DashboardSnapshot,
  patch: DashboardFigurePatch,
): DashboardSnapshot {
  return {
    ...snapshot,
    cards: snapshot.cards.map((card) => {
      if (card.id === "traffic") {
        return {
          ...card,
          stats: replaceStat(card.stats, TRAFFIC_CALLS, countText(patch.trafficCalls)),
          note: trafficNote(card.note, patch.trafficCalls, patch.trafficNote),
        };
      }
      if (card.id === "smg") {
        return {
          ...card,
          stats: replaceStat(
            replaceStat(card.stats, SMG_CALLS, countText(patch.smgCalls)),
            SMG_MINUTES,
            countText(patch.smgMinutes),
          ),
        };
      }
      if (card.id === "syslog") {
        return {
          ...card,
          stats: replaceStat(
            card.stats,
            ANTIFRAUD_EVENTS,
            countText(patch.antifraudEvents),
          ),
        };
      }
      return card;
    }),
  };
}
