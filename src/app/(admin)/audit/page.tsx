import { requirePagePermission } from "@/modules/auth/guards";
import { listAuditLogs } from "@/modules/audit/query";
import { AuditView } from "@/modules/audit/ui/audit-view";

export default async function AuditPage() {
  await requirePagePermission("audit:read");
  const initial = await listAuditLogs({ page: 1, pageSize: 100 });

  return <AuditView initial={initial} />;
}
