import { requirePagePermission } from "@/modules/auth/guards";
import {
  CDR_PHONE_COLUMNS,
  TRAFFIC_SUMMARY_COLUMNS,
  TRAFFIC_SUMMARY_LABELS,
} from "@/modules/traffic/columns";
import { loadTrafficViewData } from "@/modules/traffic/service";
import { TrafficView } from "@/modules/traffic/ui/traffic-view";

const HIGHLIGHT_COLUMNS = [...CDR_PHONE_COLUMNS, "out_orig_dnis"] as const;

export default async function TrafficPage() {
  await requirePagePermission("phones:read");
  const initial = await loadTrafficViewData();

  return (
    <TrafficView
      title="Телефонный трафик"
      subtitle="Сокращённая выборка полей из сырых CDR."
      searchInputId="traffic-phone-search"
      columns={TRAFFIC_SUMMARY_COLUMNS}
      headerLabels={TRAFFIC_SUMMARY_LABELS}
      highlightColumns={HIGHLIGHT_COLUMNS}
      showOps={false}
      canRetry={false}
      emptyUnfiltered="Нет данных."
      showMonthExport
      initial={initial}
    />
  );
}
