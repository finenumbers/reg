import type { DashboardSeriesId } from "@/modules/dashboard/series";

export type DashboardLineTone =
  | "amber"
  | "zinc"
  | "stone"
  | "slate"
  | "orange"
  | "emerald"
  | "green"
  | "teal"
  | "red"
  | "rose"
  | "violet"
  | "purple"
  | "fuchsia"
  | "sky"
  | "blue"
  | "pink";

export type DashboardChartLine = {
  id: string;
  label: string;
  tone: DashboardLineTone;
  /** Null is a gap. A count chart uses zero instead. */
  minutes: Array<number | null>;
  /** Window sum for answers. Delay leaves this empty. */
  total: number | null;
};

export type DashboardBadge = "ok" | "running" | "failed" | "empty" | "off";

export type DashboardAlert = {
  id: string;
  tone: "alert" | "info";
  text: string;
  href: string | null;
};

export type DashboardStat = {
  label: string;
  value: string;
};

export type DashboardCard = {
  id: string;
  title: string;
  href: string;
  badge: DashboardBadge;
  badgeLabel: string;
  successAt: string | null;
  load: {
    at: string;
    hadCalls: boolean;
    lastCheckedAt: string | null;
  } | null;
  packetAt: string | null;
  emptyAge: string | null;
  stats: DashboardStat[];
  note: string | null;
};

export type DashboardAntifraudNode = {
  ip: string;
  name: string;
};

export type DashboardSnapshot = {
  alerts: DashboardAlert[];
  cards: DashboardCard[];
  /** The signed-in user may see the concurrent-call chart. */
  calls: boolean;
  /**
   * Nodes that can filter the antifraud charts.
   * Null means the list could not be read. An empty array means none qualify.
   */
  antifraudNodes: DashboardAntifraudNode[] | null;
};

export type DashboardCallSeries = {
  /** ISO time of the first bucket. Labels are counted from here. */
  start: string;
  minutes: number[];
  peak: number;
  lines?: DashboardChartLine[];
};

export type DashboardCalls =
  | { status: "hidden" }
  | { status: "vacuum"; series: DashboardSeriesId; node: string | null; message: string }
  | {
      status: "unavailable";
      series: DashboardSeriesId;
      node: string | null;
      message: string;
    }
  | {
      status: "ready";
      series: DashboardSeriesId;
      /** Null is every node. An address is that syslog node. */
      node: string | null;
      day: string;
      minutes: number[];
      peak: number;
      lines?: DashboardChartLine[];
      /** Shown while the delay arrays are still being filled. */
      note?: string | null;
      recent: DashboardCallSeries;
    };
