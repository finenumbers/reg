import { requirePagePermission } from "@/modules/auth/guards";
import {
  CDR_PHONE_COLUMNS,
  TRAFFIC_OPERATORS_COLUMNS,
  TRAFFIC_OPERATORS_LABELS,
} from "@/modules/traffic/columns";
import { listTraffic } from "@/modules/traffic/service";
import { TrafficView } from "@/modules/traffic/ui/traffic-view";

const HIGHLIGHT_COLUMNS = [...CDR_PHONE_COLUMNS, "out_orig_dnis"] as const;

export default async function OperatorsPage() {
  await requirePagePermission("phones:read");
  const initial = await listTraffic({ page: 1, pageSize: 100 });

  return (
    <TrafficView
      title="Операторы связи"
      subtitle="Сигнальные адреса и провайдеры из сырых CDR."
      searchInputId="operators-phone-search"
      columns={TRAFFIC_OPERATORS_COLUMNS}
      headerLabels={TRAFFIC_OPERATORS_LABELS}
      highlightColumns={HIGHLIGHT_COLUMNS}
      showOps={false}
      canRetry={false}
      emptyUnfiltered="Нет данных."
      initial={initial}
    />
  );
}
