import { requirePagePermission } from "@/modules/auth/guards";
import { listStatsSnapshot } from "@/modules/stats/service";
import { StatsView } from "@/modules/stats/ui/stats-view";

export default async function StatsPage() {
  await requirePagePermission("phones:read");
  const initial = await listStatsSnapshot();
  return <StatsView initial={initial} />;
}
