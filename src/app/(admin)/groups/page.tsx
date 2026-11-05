import { requirePagePermission } from "@/modules/auth/guards";
import { getGroupsOperationalStatus, listRoutingGroups } from "@/modules/groups/service";
import { GroupsView } from "@/modules/groups/ui/groups-view";

export default async function GroupsPage() {
  await requirePagePermission("phones:read");
  const [initial, status] = await Promise.all([
    listRoutingGroups(),
    getGroupsOperationalStatus(),
  ]);
  return <GroupsView initial={initial} initialSync={status.sync} />;
}
