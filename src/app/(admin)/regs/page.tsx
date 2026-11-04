import { requirePagePermission } from "@/modules/auth/guards";
import { listRegistrations } from "@/modules/registrations/service";
import { RegistrationsView } from "@/modules/registrations/ui/registrations-view";

export default async function RegistrationsPage() {
  await requirePagePermission("regs:read");
  const initial = await listRegistrations({ page: 1, pageSize: 100 });
  return <RegistrationsView initial={initial} />;
}
