import { requirePagePermission } from "@/modules/auth/guards";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import type { ListFreeNumbersResult } from "@/modules/free-numbers/format";
import { listFreeNumbers } from "@/modules/free-numbers/service";
import { FreeNumbersView } from "@/modules/free-numbers/ui/free-numbers-view";

export const dynamic = "force-dynamic";

export default async function FreeNumbersPage() {
  await requirePagePermission("phones:read");
  const empty: ListFreeNumbersResult = {
    items: [],
    total: 0,
    page: 1,
    pageSize: TABLE_PAGE_SIZE,
  };
  let initial = empty;
  let initialError: string | null = null;
  try {
    initial = await listFreeNumbers({
      page: 1,
      pageSize: TABLE_PAGE_SIZE,
      filters: {},
      phoneQ: "",
    });
  } catch {
    initialError = "Не удалось загрузить свободные номера";
  }

  return <FreeNumbersView initial={initial} initialError={initialError} />;
}
