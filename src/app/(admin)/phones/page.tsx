import { requirePagePermission } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";
import { listPhones } from "@/modules/phones/service";
import { PhonesView } from "@/modules/phones/ui/phones-view";
import { countUnregisteredCurrent } from "@/modules/registrations/status";

export default async function PhonesPage() {
  const ctx = await requirePagePermission("phones:read");
  const canRequest = hasPermission(ctx.authz.permissions, "phones:request");
  const [initial, initialRegsUnregisteredCount] = await Promise.all([
    listPhones({
      kind: "endpoints_registered",
      page: 1,
      pageSize: 100,
    }),
    countUnregisteredCurrent(),
  ]);

  return (
    <PhonesView
      canRequest={canRequest}
      initial={initial}
      initialRegsUnregisteredCount={initialRegsUnregisteredCount}
    />
  );
}
