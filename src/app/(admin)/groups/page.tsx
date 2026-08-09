import { requirePagePermission } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";
import { listRoutingGroups } from "@/modules/groups/service";
import { GroupsView } from "@/modules/groups/ui/groups-view";

export default async function GroupsPage() {
  const ctx = await requirePagePermission("phones:read");
  const canRequest = hasPermission(ctx.authz.permissions, "phones:request");
  const initial = await listRoutingGroups();

  return <GroupsView canRequest={canRequest} initial={initial} />;
}
