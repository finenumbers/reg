import { requirePagePermission } from "@/modules/auth/guards";
import { listRoutingGroups } from "@/modules/groups/service";
import { GroupsView } from "@/modules/groups/ui/groups-view";

export default async function GroupsPage() {
  await requirePagePermission("phones:read");
  const initial = await listRoutingGroups();
  return <GroupsView initial={initial} />;
}
