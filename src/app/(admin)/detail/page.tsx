import { requirePagePermission } from "@/modules/auth/guards";
import { listDetailSnapshot } from "@/modules/detail/service";
import { DetailView } from "@/modules/detail/ui/detail-view";

export default async function DetailPage() {
  await requirePagePermission("phones:read");
  const initial = await listDetailSnapshot();
  return <DetailView initial={initial} />;
}
