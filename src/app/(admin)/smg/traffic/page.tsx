import { requirePagePermission } from "@/modules/auth/guards";
import { latestSmgImportCursor, listSmgCalls } from "@/modules/smg/service";
import {
  SMG_SUMMARY_COLUMNS,
  SMG_SUMMARY_FACET_COLUMNS,
  SMG_SUMMARY_LABELS,
} from "@/modules/smg/summary";
import { SmgView } from "@/modules/smg/ui/smg-view";

export default async function SmgTrafficPage() {
  await requirePagePermission("phones:read");
  const initialSince = await latestSmgImportCursor();
  const initial = await listSmgCalls({});

  return (
    <SmgView
      canRetry={false}
      initial={initial}
      initialSince={initialSince}
      title="Трафик SMG"
      subtitle="Начало звонка. Месяц и порядок строк — по времени разъединения."
      columns={SMG_SUMMARY_COLUMNS}
      headerLabels={SMG_SUMMARY_LABELS}
      showOps={false}
      searchInputId="smg-traffic-phone-search"
      highlightPhones
      facetColumns={SMG_SUMMARY_FACET_COLUMNS}
      exportLayout="traffic"
    />
  );
}
