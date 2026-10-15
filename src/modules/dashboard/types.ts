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

export type DashboardSnapshot = {
  alerts: DashboardAlert[];
  cards: DashboardCard[];
};
