import { requirePagePermission } from "@/modules/auth/guards";
import { listNumberGeography } from "@/modules/number-geography/service";
import { NumberGeographyView } from "@/modules/number-geography/ui/number-geography-view";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";

export default async function NumberGeographyPage() {
  await requirePagePermission("phones:read");
  const initial = await listNumberGeography({
    page: 1,
    pageSize: TABLE_PAGE_SIZE,
  });

  return <NumberGeographyView initial={initial} />;
}
