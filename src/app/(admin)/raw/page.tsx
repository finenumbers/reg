import { requirePagePermission } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";
import {
  CDR_COLUMNS,
  CDR_ENRICH_LABELS,
  RAW_TABLE_COLUMNS,
  VOIPMONITOR_RAW_LABELS,
} from "@/modules/traffic/columns";
import { loadTrafficViewData } from "@/modules/traffic/service";
import { TrafficView } from "@/modules/traffic/ui/traffic-view";

const HEADER_LABELS: Record<string, string> = {
  ...Object.fromEntries(CDR_COLUMNS.map((col) => [col, col])),
  ...CDR_ENRICH_LABELS,
  ...VOIPMONITOR_RAW_LABELS,
};

export default async function RawCdrPage() {
  const ctx = await requirePagePermission("phones:read");
  const canRetry = hasPermission(ctx.authz.permissions, "phones:request");
  const initial = await loadTrafficViewData();

  return (
    <TrafficView
      title="Сырые данные"
      subtitle="CDR софтсвитча из локальной базы после успешной загрузки по FTP."
      searchInputId="raw-phone-search"
      columns={RAW_TABLE_COLUMNS}
      headerLabels={HEADER_LABELS}
      showOps
      canRetry={canRetry}
      emptyUnfiltered="Нет данных. Дождитесь загрузки CDR по FTP или нажмите «Повторить импорт»."
      initial={initial}
    />
  );
}
