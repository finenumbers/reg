import { requirePagePermission } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";
import { listTraffic } from "@/modules/traffic/service";
import { TrafficView } from "@/modules/traffic/ui/traffic-view";

export default async function TrafficPage() {
  const ctx = await requirePagePermission("phones:read");
  const canRetry = hasPermission(ctx.authz.permissions, "phones:request");
  const initial = await listTraffic({ page: 1, pageSize: 100 });

  return <TrafficView canRetry={canRetry} initial={initial} />;
}
