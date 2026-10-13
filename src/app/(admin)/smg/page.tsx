import { requirePagePermission } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";
import { listSmgCalls } from "@/modules/smg/service";
import { SmgView } from "@/modules/smg/ui/smg-view";

export default async function SmgCallsPage() {
  const ctx = await requirePagePermission("phones:read");
  const canRetry = hasPermission(ctx.authz.permissions, "phones:request");
  const initial = await listSmgCalls({});

  return <SmgView canRetry={canRetry} initial={initial} />;
}
