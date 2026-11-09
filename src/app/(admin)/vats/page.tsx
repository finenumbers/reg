import { requirePagePermission } from "@/modules/auth/guards";
import { listVatsDomains } from "@/modules/vats/service";
import { VatsNameList } from "@/modules/vats/ui/name-list";

export const dynamic = "force-dynamic";

export default async function VatsDomainsPage() {
  await requirePagePermission("vats:read");
  const list = await listVatsDomains();
  return (
    <VatsNameList
      title="Домены ВАТС"
      column="Домен"
      names={list.names}
      readAt={list.readAt}
      configured={list.configured}
      refreshUrl="/api/vats/domains/refresh"
      hrefFor={(name) => `/vats/domains/${encodeURIComponent(name)}`}
    />
  );
}
