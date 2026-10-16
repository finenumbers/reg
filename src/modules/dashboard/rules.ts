/**
 * Dashboard attention rules. Pure: the service fills the facts, this decides
 * what is an incident. A switched-off poll is a badge, not an alert.
 */

import { formatCount } from "@/lib/format-count";
import { formatBytes } from "@/modules/storage/format-bytes";
import { CDR_VACUUM_BUSY_MESSAGE } from "@/modules/storage/vacuum/gate";
import { isPurgeHoldError, purgeHoldReleased } from "@/modules/traffic/poison";
import type {
  DashboardAlert,
  DashboardBadge,
  DashboardCard,
  DashboardSnapshot,
} from "@/modules/dashboard/types";

export const REGS_STALE_FLOOR_MS = 2 * 60 * 1000;
export const EXPORT_STALE_FLOOR_MS = 10 * 60 * 1000;
export const SYSLOG_STATUS_STALE_MS = 30 * 1000;
export const INBOX_ALERT_MIN = 2;
const ERROR_MAX = 180;

export type PulseStatus = "never" | "running" | "success" | "failed";

export type ScheduledPulse = {
  enabled: boolean;
  running: boolean;
  lastStatus: PulseStatus;
  lastSuccessAt: number | null;
  lastError: string | null;
};

export type ImportPulse = {
  running: boolean;
  lastStatus: PulseStatus;
  lastError: string | null;
  pendingReady: number | null;
  poisonCount: number | null;
  poisonLabel: string | null;
  loadKnown: boolean;
  lastPassAt: number | null;
  hadCalls: boolean;
  lastCheckedAt: number | null;
};

export type TrafficPulse = ImportPulse & {
  monthCalls: number | null;
  monthNote: string | null;
};

export type SyslogPulse = {
  enabled: boolean;
  filePresent: boolean;
  updatedAt: number | null;
  listening: boolean;
  bindError: string | null;
  lowSpace: boolean;
  freeBytes: number | null;
  unknownTotal: number;
  lastPacketAt: number | null;
};

export type DashboardFacts = {
  now: number;
  regsIntervalSec: number;
  exportIntervalSec: number;
  jobsOk: boolean;
  regs:
    | (ScheduledPulse & {
        registered: number | null;
        unregistered: number | null;
        total: number | null;
      })
    | null;
  phones:
    | (ScheduledPulse & {
        endpointCount: number | null;
        gatewayCount: number | null;
      })
    | null;
  groups: ScheduledPulse | null;
  traffic: TrafficPulse | null;
  smg: ImportPulse | null;
  syslog: SyslogPulse | null;
  vacuumActive: boolean;
  purgeActive: boolean;
  showMaintenance: boolean;
};

type CardModel = Omit<DashboardCard, "successAt" | "load" | "packetAt"> & {
  successAt: number | null;
  load: {
    at: number;
    hadCalls: boolean;
    lastCheckedAt: number | null;
  } | null;
  packetAt: number | null;
};

const BADGE_LABEL: Record<DashboardBadge, string> = {
  ok: "норма",
  running: "идёт",
  failed: "ошибка",
  empty: "нет данных",
  off: "выключено",
};

export function regsStaleAfterMs(intervalSec: number): number {
  return Math.max(REGS_STALE_FLOOR_MS, 2 * clampedIntervalMs(intervalSec));
}

/** phones.sync and groups.sync alternate, so each leg is two intervals apart. */
export function exportStaleAfterMs(intervalSec: number): number {
  return Math.max(EXPORT_STALE_FLOOR_MS, 4 * clampedIntervalMs(intervalSec));
}

function clampedIntervalMs(intervalSec: number): number {
  const sec = Number.isFinite(intervalSec) ? intervalSec : 30;
  return Math.max(30, sec) * 1000;
}

export function clipError(error: string | null | undefined): string {
  const text = (error ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "без текста ошибки";
  if (text.length <= ERROR_MAX) return text;
  return `${text.slice(0, ERROR_MAX - 1)}…`;
}

/** A purge hold for the live month is expected. A released hold is poison again. */
export function isDashboardPoison(error: string, heldForPurge: boolean): boolean {
  if (!heldForPurge && !isPurgeHoldError(error)) return true;
  return purgeHoldReleased(error);
}

export function cachedMonthCalls(
  months: readonly { key: string; count?: number }[] | null,
  key: string,
): number | null {
  if (!months) return null;
  const row = months.find((item) => item.key === key);
  if (!row || row.count == null) return null;
  return row.count;
}

export function buildDashboard(facts: DashboardFacts): {
  alerts: DashboardAlert[];
  cards: CardModel[];
} {
  const alerts: DashboardAlert[] = [];
  const cards: CardModel[] = [];

  if (!facts.jobsOk) {
    alerts.push({
      id: "jobs",
      tone: "alert",
      text: "Не удалось прочитать состояние задач.",
      href: "/jobs",
    });
  }

  if (facts.regs) {
    if (facts.jobsOk) {
      pushScheduledAlerts(alerts, facts.regs, {
        id: "regs",
        href: "/regs",
        failed: "Опрос регистраций не прошёл",
        never: "Опрос регистраций включён, успешного прогона ещё не было.",
        stale: "Опрос регистраций устарел.",
        thresholdMs: regsStaleAfterMs(facts.regsIntervalSec),
        now: facts.now,
      });
    }
    cards.push(
      scheduledCard(
        facts.regs,
        facts.jobsOk,
        facts.now,
        regsStaleAfterMs(facts.regsIntervalSec),
        {
          id: "registrations",
          title: "Регистрации",
          href: "/regs",
          emptyAge: "нет успешных опросов",
          stats: [
            { label: "Зарегистрировано", value: countOrGap(facts.regs.registered) },
            { label: "Не зарегистрировано", value: countOrGap(facts.regs.unregistered) },
            { label: "Всего", value: countOrGap(facts.regs.total) },
          ],
        },
      ),
    );
  }

  if (facts.phones) {
    if (facts.jobsOk) {
      pushScheduledAlerts(alerts, facts.phones, {
        id: "phones",
        href: "/phones",
        failed: "Загрузка номеров не прошла",
        never: "Загрузка номеров включена, успешного прогона ещё не было.",
        stale: "Загрузка номеров устарела.",
        thresholdMs: exportStaleAfterMs(facts.exportIntervalSec),
        now: facts.now,
      });
    }
    cards.push(
      scheduledCard(
        facts.phones,
        facts.jobsOk,
        facts.now,
        exportStaleAfterMs(facts.exportIntervalSec),
        {
          id: "phones",
          title: "Телефонные номера",
          href: "/phones",
          emptyAge: "нет успешных загрузок",
          stats: [
            { label: "Оконечные", value: countOrGap(facts.phones.endpointCount) },
            { label: "Шлюзы", value: countOrGap(facts.phones.gatewayCount) },
          ],
        },
      ),
    );
  }

  if (facts.groups && facts.jobsOk) {
    pushScheduledAlerts(alerts, facts.groups, {
      id: "groups",
      href: "/groups",
      failed: "Загрузка групп не прошла",
      never: "Загрузка групп включена, успешного прогона ещё не было.",
      stale: "Загрузка групп устарела.",
      thresholdMs: exportStaleAfterMs(facts.exportIntervalSec),
      now: facts.now,
    });
  }

  if (facts.traffic) {
    pushImportAlerts(alerts, facts.traffic, facts.jobsOk, {
      id: "traffic",
      href: "/traffic",
      failed: "Импорт CDR не прошёл",
      pending: "В FTP-папке",
      poisonHref: "/raw",
      poisonWhere: "В FTP-папке",
      poisonTail: " Подробности на странице «Сырые данные».",
    });
    cards.push(
      importCard(facts.traffic, facts.jobsOk, {
        id: "traffic",
        title: "Телефонный трафик",
        href: "/traffic",
        stats: [
          { label: "Звонки, этот месяц", value: monthValue(facts.traffic) },
          { label: "Во входящих", value: countOrGap(facts.traffic.pendingReady) },
          { label: "Отложено", value: countOrGap(facts.traffic.poisonCount) },
        ],
        note: facts.traffic.monthNote,
      }),
    );
  }

  if (facts.smg) {
    pushImportAlerts(alerts, facts.smg, facts.jobsOk, {
      id: "smg",
      href: "/smg",
      failed: "Импорт SMG не прошёл",
      pending: "В папке SMG",
      poisonHref: "/smg",
      poisonWhere: "В папке SMG",
      poisonTail: "",
    });
    cards.push(
      importCard(facts.smg, facts.jobsOk, {
        id: "smg",
        title: "Звонки на SMG",
        href: "/smg",
        stats: [
          { label: "Во входящих", value: countOrGap(facts.smg.pendingReady) },
          { label: "Отложено", value: countOrGap(facts.smg.poisonCount) },
        ],
        note: null,
      }),
    );
  }

  if (facts.syslog) {
    pushSyslogAlerts(alerts, facts.syslog, facts.now);
    cards.push(syslogCard(facts.syslog, facts.now));
  }

  if (facts.showMaintenance && facts.vacuumActive) {
    alerts.push({
      id: "vacuum",
      tone: "info",
      text: CDR_VACUUM_BUSY_MESSAGE,
      href: null,
    });
  }
  if (facts.showMaintenance && facts.purgeActive) {
    alerts.push({
      id: "purge",
      tone: "info",
      text: "Идёт удаление месяца.",
      href: null,
    });
  }

  return { alerts, cards };
}

export function toDashboardSnapshot(model: {
  alerts: DashboardAlert[];
  cards: CardModel[];
}): Omit<DashboardSnapshot, "calls"> {
  return {
    alerts: model.alerts,
    cards: model.cards.map((card) => ({
      id: card.id,
      title: card.title,
      href: card.href,
      badge: card.badge,
      badgeLabel: card.badgeLabel,
      successAt: iso(card.successAt),
      load: card.load
        ? {
            at: new Date(card.load.at).toISOString(),
            hadCalls: card.load.hadCalls,
            lastCheckedAt: iso(card.load.lastCheckedAt),
          }
        : null,
      packetAt: iso(card.packetAt),
      emptyAge: card.emptyAge,
      stats: card.stats,
      note: card.note,
    })),
  };
}

function iso(ms: number | null): string | null {
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

function pushScheduledAlerts(
  alerts: DashboardAlert[],
  pulse: ScheduledPulse,
  copy: {
    id: string;
    href: string;
    failed: string;
    never: string;
    stale: string;
    thresholdMs: number;
    now: number;
  },
): void {
  if (!pulse.enabled) return;
  if (pulse.lastStatus === "failed") {
    alerts.push({
      id: `${copy.id}-failed`,
      tone: "alert",
      text: `${copy.failed}: ${clipError(pulse.lastError)}`,
      href: copy.href,
    });
    return;
  }
  if (pulse.running) return;
  if (pulse.lastSuccessAt == null) {
    alerts.push({
      id: `${copy.id}-never`,
      tone: "alert",
      text: copy.never,
      href: copy.href,
    });
    return;
  }
  if (copy.now - pulse.lastSuccessAt > copy.thresholdMs) {
    alerts.push({
      id: `${copy.id}-stale`,
      tone: "alert",
      text: copy.stale,
      href: copy.href,
    });
  }
}

function scheduledBadge(
  pulse: ScheduledPulse,
  jobsOk: boolean,
  now: number,
  thresholdMs: number,
): DashboardBadge {
  if (!jobsOk) return "failed";
  if (!pulse.enabled) return "off";
  if (pulse.running) return "running";
  if (pulse.lastStatus === "failed") return "failed";
  if (pulse.lastSuccessAt == null) return "empty";
  if (now - pulse.lastSuccessAt > thresholdMs) return "failed";
  return "ok";
}

function scheduledCard(
  pulse: ScheduledPulse,
  jobsOk: boolean,
  now: number,
  thresholdMs: number,
  copy: {
    id: string;
    title: string;
    href: string;
    emptyAge: string;
    stats: DashboardCard["stats"];
  },
): CardModel {
  const badge = scheduledBadge(pulse, jobsOk, now, thresholdMs);
  return {
    id: copy.id,
    title: copy.title,
    href: copy.href,
    badge,
    badgeLabel: BADGE_LABEL[badge],
    successAt: jobsOk ? pulse.lastSuccessAt : null,
    load: null,
    packetAt: null,
    emptyAge: jobsOk && pulse.lastSuccessAt == null ? copy.emptyAge : null,
    stats: copy.stats,
    note: jobsOk ? null : "Статус задач недоступен.",
  };
}

function pushImportAlerts(
  alerts: DashboardAlert[],
  pulse: ImportPulse,
  jobsOk: boolean,
  copy: {
    id: string;
    href: string;
    failed: string;
    pending: string;
    poisonHref: string;
    poisonWhere: string;
    poisonTail: string;
  },
): void {
  if (jobsOk && pulse.lastStatus === "failed") {
    alerts.push({
      id: `${copy.id}-failed`,
      tone: "alert",
      text: `${copy.failed}: ${clipError(pulse.lastError)}`,
      href: copy.href,
    });
  }
  if ((pulse.poisonCount ?? 0) > 0) {
    const count = pulse.poisonCount ?? 0;
    const files =
      count === 1 ? "1 файл отложен" : `${formatCount(count)} файлов отложены`;
    const detail = pulse.poisonLabel ? ` (${pulse.poisonLabel})` : "";
    alerts.push({
      id: `${copy.id}-poison`,
      tone: "alert",
      text: `${copy.poisonWhere} ${files}${detail}.${copy.poisonTail}`,
      href: copy.poisonHref,
    });
  }
  if (
    !pulse.running &&
    pulse.pendingReady != null &&
    pulse.pendingReady >= INBOX_ALERT_MIN
  ) {
    alerts.push({
      id: `${copy.id}-inbox`,
      tone: "alert",
      text: `${copy.pending} ${formatCount(pulse.pendingReady)} необработанных файлов, импорт не идёт.`,
      href: copy.href,
    });
  }
}

function importBadge(pulse: ImportPulse, jobsOk: boolean): DashboardBadge {
  if (!jobsOk) return "failed";
  if (pulse.running) return "running";
  if (pulse.lastStatus === "failed") return "failed";
  if ((pulse.poisonCount ?? 0) > 0) return "failed";
  if (!pulse.loadKnown) return "failed";
  if (pulse.pendingReady != null && pulse.pendingReady >= INBOX_ALERT_MIN) {
    return "failed";
  }
  if (pulse.lastPassAt == null && pulse.lastStatus === "never") return "empty";
  return "ok";
}

function importCard(
  pulse: ImportPulse,
  jobsOk: boolean,
  copy: {
    id: string;
    title: string;
    href: string;
    stats: DashboardCard["stats"];
    note: string | null;
  },
): CardModel {
  const badge = importBadge(pulse, jobsOk);
  const note = jobsOk
    ? joinNotes(copy.note, pulse.loadKnown ? null : "Возраст загрузки недоступен.")
    : joinNotes("Статус задач недоступен.", copy.note);
  return {
    id: copy.id,
    title: copy.title,
    href: copy.href,
    badge,
    badgeLabel: BADGE_LABEL[badge],
    successAt: null,
    load:
      jobsOk && pulse.loadKnown && pulse.lastPassAt != null
        ? {
            at: pulse.lastPassAt,
            hadCalls: pulse.hadCalls,
            lastCheckedAt: pulse.lastCheckedAt,
          }
        : null,
    packetAt: null,
    emptyAge:
      jobsOk && pulse.loadKnown && pulse.lastPassAt == null ? "нет загрузок" : null,
    stats: copy.stats,
    note,
  };
}

function pushSyslogAlerts(
  alerts: DashboardAlert[],
  syslog: SyslogPulse,
  now: number,
): void {
  if (!syslog.enabled) return;
  const href = "/smg/syslog";
  if (!syslog.filePresent || syslog.updatedAt == null) {
    alerts.push({
      id: "syslog-missing",
      tone: "alert",
      text: "Приём syslog включён, статуса нет.",
      href,
    });
    return;
  }
  if (now - syslog.updatedAt > SYSLOG_STATUS_STALE_MS) {
    alerts.push({
      id: "syslog-stale",
      tone: "alert",
      text: "Приёмник syslog не обновляет статус.",
      href,
    });
    return;
  }
  if (!syslog.listening) {
    alerts.push({
      id: "syslog-listen",
      tone: "alert",
      text: syslog.bindError
        ? `Приём syslog не запустился: ${clipError(syslog.bindError)}`
        : "Приём syslog включён, сокет не слушает.",
      href,
    });
  }
  if (syslog.lowSpace) {
    alerts.push({
      id: "syslog-space",
      tone: "alert",
      text: "На томе syslog мало места.",
      href,
    });
  }
  if (syslog.unknownTotal > 0) {
    alerts.push({
      id: "syslog-unknown",
      tone: "alert",
      text: `Syslog принимает пакеты с неизвестных адресов: ${formatCount(syslog.unknownTotal)}.`,
      href,
    });
  }
}

function syslogCard(syslog: SyslogPulse, now: number): CardModel {
  const badge = syslogBadge(syslog, now);
  return {
    id: "syslog",
    title: "Syslog",
    href: "/smg/syslog",
    badge,
    badgeLabel: BADGE_LABEL[badge],
    successAt: null,
    load: null,
    packetAt: syslog.lastPacketAt,
    emptyAge:
      syslog.enabled && syslog.lastPacketAt == null ? "пакетов ещё не было" : null,
    stats: [
      {
        label: "Свободно",
        value: syslog.freeBytes == null ? "…" : formatBytes(syslog.freeBytes),
      },
      { label: "Неизвестные адреса", value: formatCount(syslog.unknownTotal) },
    ],
    note: null,
  };
}

function syslogBadge(syslog: SyslogPulse, now: number): DashboardBadge {
  if (!syslog.enabled) return "off";
  if (!syslog.filePresent || syslog.updatedAt == null) return "failed";
  if (now - syslog.updatedAt > SYSLOG_STATUS_STALE_MS) return "failed";
  if (!syslog.listening || syslog.lowSpace || syslog.unknownTotal > 0) return "failed";
  return "ok";
}

function monthValue(traffic: TrafficPulse): string {
  if (traffic.monthCalls == null) return "…";
  return formatCount(traffic.monthCalls);
}

function countOrGap(value: number | null): string {
  if (value == null) return "…";
  return formatCount(value);
}

function joinNotes(a: string | null, b: string | null): string | null {
  const parts = [a, b].filter((item): item is string => Boolean(item));
  return parts.length > 0 ? parts.join(" ") : null;
}
