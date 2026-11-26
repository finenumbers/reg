import { requirePagePermission } from "@/modules/auth/guards";
import { CostEstimateView } from "@/modules/cost-estimate/ui/cost-estimate-view";

export default async function CostEstimatePage() {
  await requirePagePermission("phones:read");
  return <CostEstimateView />;
}
