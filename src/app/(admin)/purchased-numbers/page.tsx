import { requirePagePermission } from "@/modules/auth/guards";
import { DidClientError } from "@/modules/did/client";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import type { ListPurchasedNumbersResult } from "@/modules/purchased-numbers/format";
import { listPurchasedNumbers } from "@/modules/purchased-numbers/service";
import { PurchasedNumbersView } from "@/modules/purchased-numbers/ui/purchased-numbers-view";

export const dynamic = "force-dynamic";

export default async function PurchasedNumbersPage() {
  await requirePagePermission("phones:read");
  const empty: ListPurchasedNumbersResult = {
    items: [],
    total: 0,
    page: 1,
    pageSize: TABLE_PAGE_SIZE,
  };
  let initial = empty;
  let initialError: string | null = null;
  try {
    initial = await listPurchasedNumbers({
      page: 1,
      pageSize: TABLE_PAGE_SIZE,
      filters: {},
      phoneQ: "",
    });
  } catch (error) {
    initialError =
      error instanceof DidClientError
        ? error.message
        : "Не удалось загрузить купленные номера";
  }

  return <PurchasedNumbersView initial={initial} initialError={initialError} />;
}
