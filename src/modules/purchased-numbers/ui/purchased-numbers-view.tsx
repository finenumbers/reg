"use client";

import { CatalogNumbersView } from "@/modules/did-catalog/ui/catalog-numbers-view";
import { displayFreeNumberFacet } from "@/modules/free-numbers/format";
import { fetchPurchasedNumbersList } from "@/modules/purchased-numbers/api-client";
import { PURCHASED_NUMBER_HEADERS } from "@/modules/purchased-numbers/columns";
import type { ListPurchasedNumbersResult } from "@/modules/purchased-numbers/format";
import { PurchasedNumbersTable } from "@/modules/purchased-numbers/ui/purchased-numbers-table";

type Props = {
  initial: ListPurchasedNumbersResult;
  initialError: string | null;
};

export function PurchasedNumbersView({ initial, initialError }: Props) {
  return (
    <CatalogNumbersView
      title="Купленные номера"
      description="Каталог DID. Поиск номера и фильтры столбцов применяются вместе."
      phoneInputId="purchased-numbers-phone-search"
      headers={PURCHASED_NUMBER_HEADERS}
      formatValue={displayFreeNumberFacet}
      initial={initial}
      initialError={initialError}
      fetchList={fetchPurchasedNumbersList}
      Table={PurchasedNumbersTable}
      exportEndpoint="/api/purchased-numbers/export"
    />
  );
}
