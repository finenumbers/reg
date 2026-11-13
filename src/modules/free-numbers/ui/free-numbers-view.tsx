"use client";

import { CatalogNumbersView } from "@/modules/did-catalog/ui/catalog-numbers-view";
import { fetchFreeNumbersList } from "@/modules/free-numbers/api-client";
import { FREE_NUMBER_HEADERS } from "@/modules/free-numbers/columns";
import {
  displayFreeNumberFacet,
  type ListFreeNumbersResult,
} from "@/modules/free-numbers/format";
import { FreeNumbersTable } from "@/modules/free-numbers/ui/free-numbers-table";

type Props = {
  initial: ListFreeNumbersResult;
  initialError: string | null;
};

export function FreeNumbersView({ initial, initialError }: Props) {
  return (
    <CatalogNumbersView
      title="Свободные номера"
      description="Поиск номера и фильтры столбцов применяются вместе."
      phoneInputId="free-numbers-phone-search"
      headers={FREE_NUMBER_HEADERS}
      formatValue={displayFreeNumberFacet}
      initial={initial}
      initialError={initialError}
      fetchList={fetchFreeNumbersList}
      Table={FreeNumbersTable}
      exportEndpoint="/api/free-numbers/export"
    />
  );
}
