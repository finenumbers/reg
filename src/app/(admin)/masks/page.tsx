import { requirePagePermission } from "@/modules/auth/guards";
import { listNumberMasks } from "@/modules/masks/service";
import { MasksView } from "@/modules/masks/ui/masks-view";

export default async function MasksPage() {
  await requirePagePermission("phones:read");
  const initial = await listNumberMasks({ page: 1, pageSize: 100 });
  return <MasksView initial={initial} />;
}
