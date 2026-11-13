import { requirePagePermission } from "@/modules/auth/guards";
import { loadOprsPageInitial } from "@/modules/oprs/service";
import { CDR_PHONE_COLUMNS, OPRS_COLUMNS, OPRS_LABELS } from "@/modules/traffic/columns";
import { TrafficView } from "@/modules/traffic/ui/traffic-view";

const HIGHLIGHT_COLUMNS = [...CDR_PHONE_COLUMNS, "out_orig_dnis"] as const;
const BOLD_COLUMNS = ["bill_ani", "bill_dnis"] as const;

export default async function OprsPage() {
  await requirePagePermission("phones:read");
  const { initial, initialListError } = await loadOprsPageInitial();

  return (
    <TrafficView
      source="oprs"
      title="Звонки в ОПРС"
      subtitle="Исходящие на мобильные РФ, кроме Service_Parking."
      searchInputId="oprs-phone-search"
      columns={OPRS_COLUMNS}
      headerLabels={OPRS_LABELS}
      highlightColumns={HIGHLIGHT_COLUMNS}
      boldColumns={BOLD_COLUMNS}
      showOps={false}
      canRetry={false}
      emptyUnfiltered="Нет данных."
      initial={initial}
      initialSnapshot={initial.snapshot}
      initialListError={initialListError}
    />
  );
}
