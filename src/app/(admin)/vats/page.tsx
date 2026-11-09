import { requirePagePermission } from "@/modules/auth/guards";
import { getVatsDomainPage } from "@/modules/vats/service";
import { VatsDomainTable } from "@/modules/vats/ui/section-table";

export const dynamic = "force-dynamic";

export default async function VatsDomainsPage() {
  await requirePagePermission("vats:read");
  const page = await getVatsDomainPage(0);
  return (
    <VatsDomainTable
      title="Домены ВАТС"
      rows={page.rows}
      total={page.total}
      readAt={page.readAt}
      notice={page.notice}
    />
  );
}
