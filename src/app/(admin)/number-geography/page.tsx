import { requirePagePermission } from "@/modules/auth/guards";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { listNumberGeography } from "@/modules/number-geography/service";
import { NumberGeographyView } from "@/modules/number-geography/ui/number-geography-view";
import { hasPermission } from "@/modules/rbac/permissions";

export default async function NumberGeographyPage() {
  const ctx = await requirePagePermission("phones:read");
  const canRequest = hasPermission(ctx.authz.permissions, "phones:request");
  const canActivate = hasPermission(ctx.authz.permissions, "phones:activate");
  const initial = await listNumberGeography({
    page: 1,
    pageSize: TABLE_PAGE_SIZE,
  });

  return (
    <NumberGeographyView
      initial={initial}
      canRequest={canRequest}
      canActivate={canActivate}
    />
  );
}
