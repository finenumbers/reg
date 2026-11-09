import { requirePagePermission } from "@/modules/auth/guards";
import { listVatsTelnums } from "@/modules/vats/service";
import { VatsNameList } from "@/modules/vats/ui/name-list";

export const dynamic = "force-dynamic";

export default async function VatsTelnumsPage() {
  await requirePagePermission("vats:read");
  const list = await listVatsTelnums();
  return (
    <VatsNameList
      title="Номера ВАТС"
      column="Номер"
      names={list.names}
      readAt={list.readAt}
      configured={list.configured}
      refreshUrl="/api/vats/telnums/refresh"
      hrefFor={(name) => `/vats/telnums/${encodeURIComponent(name)}`}
    />
  );
}
