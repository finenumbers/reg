import { requirePagePermission } from "@/modules/auth/guards";
import {
  CDR_PHONE_COLUMNS,
  TRAFFIC_BILLING_COLUMNS,
  TRAFFIC_BILLING_LABELS,
  TRAFFIC_BOLD_COLUMNS,
} from "@/modules/traffic/columns";
import { loadTrafficViewData } from "@/modules/traffic/service";
import { TrafficView } from "@/modules/traffic/ui/traffic-view";

const HIGHLIGHT_COLUMNS = [...CDR_PHONE_COLUMNS, "out_orig_dnis"] as const;
const BOLD_COLUMNS = [...TRAFFIC_BOLD_COLUMNS, "tariff_charge"] as const;

export default async function BillingPage() {
  await requirePagePermission("phones:read");
  const initial = await loadTrafficViewData();

  return (
    <TrafficView
      title="Биллинг звонков"
      subtitle="Направление, стоимость, себестоимость и прибыль по сырым CDR."
      searchInputId="billing-phone-search"
      columns={TRAFFIC_BILLING_COLUMNS}
      headerLabels={TRAFFIC_BILLING_LABELS}
      highlightColumns={HIGHLIGHT_COLUMNS}
      boldColumns={BOLD_COLUMNS}
      showOps={false}
      canRetry={false}
      emptyUnfiltered="Нет данных."
      initial={initial}
    />
  );
}
