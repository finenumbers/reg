import { requirePagePermission } from "@/modules/auth/guards";
import { listStorageSnapshot } from "@/modules/storage/service";
import { StorageView } from "@/modules/storage/ui/storage-view";

export default async function StoragePage() {
  await requirePagePermission("settings:write");
  const initial = await listStorageSnapshot();
  return <StorageView initial={initial} />;
}
