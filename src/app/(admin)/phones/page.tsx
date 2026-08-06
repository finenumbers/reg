import { requirePagePermission } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";
import { listPhones } from "@/modules/phones/service";
import { PhonesView } from "@/modules/phones/ui/phones-view";

export default async function PhonesPage() {
  const ctx = await requirePagePermission("phones:read");
  const canRequest = hasPermission(ctx.authz.permissions, "phones:request");
  const initial = await listPhones({
    kind: "endpoints_registered",
    page: 1,
    pageSize: 100,
  });

  return <PhonesView canRequest={canRequest} initial={initial} />;
}
