import { requirePagePermission } from "@/modules/auth/guards";
import { loadAntifraudPageInitial } from "@/modules/antifraud/service";
import { AntifraudView } from "@/modules/antifraud/ui/antifraud-view";

export default async function AntifraudPage() {
  await requirePagePermission("phones:read");
  const { initial, initialListError } = await loadAntifraudPageInitial();
  return <AntifraudView initial={initial} initialListError={initialListError} />;
}
