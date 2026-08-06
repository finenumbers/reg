import { requirePagePermission } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";
import { listRegistrations } from "@/modules/registrations/service";
import { RegistrationsView } from "@/modules/registrations/ui/registrations-view";

export default async function RegistrationsPage() {
  const ctx = await requirePagePermission("regs:read");
  const canPoll = hasPermission(ctx.authz.permissions, "regs:poll");
  const initial = await listRegistrations({ page: 1, pageSize: 100 });

  return <RegistrationsView canPoll={canPoll} initial={initial} />;
}
