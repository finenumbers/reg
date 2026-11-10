export type ZabbixLineView = {
  id: string;
  label: string;
  unit: string;
  color: string;
  minutes: (number | null)[];
};

export type ZabbixGraphView = {
  slot: 1 | 2;
  title: string;
  host: string;
  message: string | null;
  note: string | null;
  lines: ZabbixLineView[] | null;
};

export type ZabbixDashboardBody =
  | { status: "hidden" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; origin: string; graphs: ZabbixGraphView[] };
