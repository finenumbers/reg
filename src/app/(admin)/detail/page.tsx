import { requirePagePermission } from "@/modules/auth/guards";
import { loadDetailPageInitial } from "@/modules/detail/service";
import { DetailView } from "@/modules/detail/ui/detail-view";

export default async function DetailPage() {
  await requirePagePermission("phones:read");
  const { initial, initialError } = await loadDetailPageInitial();
  return <DetailView initial={initial} initialError={initialError} />;
}
