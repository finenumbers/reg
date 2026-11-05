import { requirePagePermission } from "@/modules/auth/guards";
import { listRegistrations } from "@/modules/registrations/service";
import { getRegistrationsOperationalStatus } from "@/modules/registrations/status";
import { RegistrationsView } from "@/modules/registrations/ui/registrations-view";

export default async function RegistrationsPage() {
  await requirePagePermission("regs:read");
  const [initial, status] = await Promise.all([
    listRegistrations({ page: 1, pageSize: 100 }),
    getRegistrationsOperationalStatus(),
  ]);
  return <RegistrationsView initial={initial} initialSync={status.sync} />;
}
