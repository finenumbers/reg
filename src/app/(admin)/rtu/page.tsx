import { requirePagePermission } from "@/modules/auth/guards";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { listRtu } from "@/modules/rtu/service";
import { RtuView } from "@/modules/rtu/ui/rtu-view";
import { hasPermission } from "@/modules/rbac/permissions";

export default async function RtuPage() {
  const ctx = await requirePagePermission("phones:read");
  const canRequest = hasPermission(ctx.authz.permissions, "phones:request");
  const canActivate = hasPermission(ctx.authz.permissions, "phones:activate");
  const initial = await listRtu({
    page: 1,
    pageSize: TABLE_PAGE_SIZE,
  });

  return <RtuView initial={initial} canRequest={canRequest} canActivate={canActivate} />;
}
