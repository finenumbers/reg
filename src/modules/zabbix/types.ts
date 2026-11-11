export type ZabbixLineView = {
  id: string;
  label: string;
  unit: string;
  color: string;
  minutes: (number | null)[];
};

/** Home-page heading. A blank title keeps the Zabbix graph name. */
export function zabbixGraphHeading(
  title: string | null | undefined,
  fallback: string,
): string {
  const text = title?.trim() ?? "";
  return text.length > 0 ? text : fallback;
}

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
