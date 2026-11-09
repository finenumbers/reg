import { requirePagePermission } from "@/modules/auth/guards";
import { getVatsTelnumPage } from "@/modules/vats/service";
import { VatsTelnumTable } from "@/modules/vats/ui/section-table";

export const dynamic = "force-dynamic";

export default async function VatsTelnumsPage() {
  await requirePagePermission("vats:read");
  const page = await getVatsTelnumPage(0);
  return (
    <VatsTelnumTable
      title="Номера ВАТС"
      rows={page.rows}
      total={page.total}
      readAt={page.readAt}
      notice={page.notice}
    />
  );
}
