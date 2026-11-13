import { requirePagePermission } from "@/modules/auth/guards";
import { listMarkingRows } from "@/modules/marking/service";
import { MarkingView } from "@/modules/marking/ui/marking-view";

export default async function MarkingPage() {
  await requirePagePermission("phones:read");
  const initial = await listMarkingRows({ page: 1, pageSize: 100 });
  return <MarkingView initial={initial} />;
}
