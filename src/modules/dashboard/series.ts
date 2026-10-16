/** Choices for the dashboard call charts. Stored class labels stay in the SQL. */

export const DASHBOARD_SERIES = [
  { id: "phone", label: "Телефонный трафик" },
  { id: "client", label: "Клиентский трафик" },
  { id: "phantom", label: "Фантомный трафик" },
  { id: "parking-in", label: "Входящий паркинг" },
  { id: "parking-out", label: "Исходящий паркинг" },
  { id: "errors", label: "Ошибки звонков" },
] as const;

export type DashboardSeriesId = (typeof DASHBOARD_SERIES)[number]["id"];

export type ConcurrencySeriesId = Exclude<DashboardSeriesId, "errors">;

const SERIES_IDS = new Set<string>(DASHBOARD_SERIES.map((item) => item.id));

/** Missing query means the phone chart. Any other unknown value is rejected. */
export function parseDashboardSeries(raw: string | null): DashboardSeriesId | null {
  if (raw == null || raw === "") return "phone";
  if (!SERIES_IDS.has(raw)) return null;
  return raw as DashboardSeriesId;
}

export function dashboardSeriesLabel(id: DashboardSeriesId): string {
  const found = DASHBOARD_SERIES.find((item) => item.id === id);
  return found?.label ?? DASHBOARD_SERIES[0].label;
}
