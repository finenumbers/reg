import { requirePagePermission } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";
import { SMG_FIELDS, SMG_HEADER_LABELS } from "@/modules/smg/columns";
import { latestSmgImportCursor, listSmgCalls } from "@/modules/smg/service";
import { SmgView } from "@/modules/smg/ui/smg-view";

export default async function SmgCallsPage() {
  const ctx = await requirePagePermission("phones:read");
  const canRetry = hasPermission(ctx.authz.permissions, "phones:request");
  const initialSince = await latestSmgImportCursor();
  const initial = await listSmgCalls({});

  return (
    <SmgView
      canRetry={canRetry}
      initial={initial}
      initialSince={initialSince}
      title="Звонки на SMG"
      subtitle="Полный дамп CDR цифровых шлюзов Eltex SMG-1016M из локальной базы."
      columns={SMG_FIELDS}
      headerLabels={SMG_HEADER_LABELS}
      showOps
      searchInputId="smg-phone-search"
    />
  );
}
