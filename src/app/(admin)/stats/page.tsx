import { requirePagePermission } from "@/modules/auth/guards";
import { loadStatsPageInitial } from "@/modules/stats/service";
import { StatsView } from "@/modules/stats/ui/stats-view";

export default async function StatsPage() {
  await requirePagePermission("phones:read");
  const { initial, initialError } = await loadStatsPageInitial();
  return <StatsView initial={initial} initialError={initialError} />;
}
