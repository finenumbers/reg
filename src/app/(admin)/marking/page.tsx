import { requirePagePermission } from "@/modules/auth/guards";
import { loadMarkingStatsPageInitial } from "@/modules/marking/stats";
import { MarkingView } from "@/modules/marking/ui/marking-view";

export default async function MarkingPage() {
  await requirePagePermission("phones:read");
  const { initial, initialError } = await loadMarkingStatsPageInitial();
  return <MarkingView initialStats={initial} initialStatsError={initialError} />;
}
