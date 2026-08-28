import { requirePagePermission } from "@/modules/auth/guards";
import {
  CDR_PHONE_COLUMNS,
  TRAFFIC_GEOGRAPHY_COLUMNS,
  TRAFFIC_GEOGRAPHY_LABELS,
} from "@/modules/traffic/columns";
import { listTraffic } from "@/modules/traffic/service";
import { TrafficView } from "@/modules/traffic/ui/traffic-view";

const HIGHLIGHT_COLUMNS = [...CDR_PHONE_COLUMNS, "out_orig_dnis"] as const;

export default async function GeographyPage() {
  await requirePagePermission("phones:read");
  const initial = await listTraffic({ page: 1, pageSize: 100 });

  return (
    <TrafficView
      title="География звонков"
      subtitle="Стороны, операторы и география номеров из сырых CDR."
      searchInputId="geography-phone-search"
      columns={TRAFFIC_GEOGRAPHY_COLUMNS}
      headerLabels={TRAFFIC_GEOGRAPHY_LABELS}
      highlightColumns={HIGHLIGHT_COLUMNS}
      showOps={false}
      canRetry={false}
      emptyUnfiltered="Нет данных."
      initial={initial}
    />
  );
}
