"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { PhoneSearchInput } from "@/components/phone-search-input";
import { Button } from "@/components/ui/button";
import {
  ActiveFiltersBar,
  hasActiveFilters,
  removeFacetValue,
  setColumnFilterValues,
  type ColumnFilters,
} from "@/components/column-filters";
import { TableCountFooter, TableInfiniteBody } from "@/components/table-infinite-body";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { fetchFreeNumbersList } from "@/modules/free-numbers/api-client";
import { FREE_NUMBER_HEADERS } from "@/modules/free-numbers/columns";
import {
  displayFreeNumberFacet,
  type ListFreeNumbersResult,
} from "@/modules/free-numbers/format";
import { FreeNumbersTable } from "@/modules/free-numbers/ui/free-numbers-table";

const PAGE_SIZE = TABLE_PAGE_SIZE;
const PHONE_SEARCH_DEBOUNCE_MS = 300;

type Props = {
  initial: ListFreeNumbersResult;
  initialError: string | null;
};

export function FreeNumbersView({ initial, initialError }: Props) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const [openColumn, setOpenColumn] = useState<string | null>(null);
  const [page, setPage] = useState(initial.page);
  const [items, setItems] = useState(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(initialError);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  const refreshSeq = useRef(0);
  const inFlightRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const filtersRef = useRef(filters);
  const phoneQRef = useRef(phoneQ);
  const phoneSearchTimerRef = useRef<number | null>(null);
  const pageRef = useRef(page);
  const totalRef = useRef(total);
  const loadListRef = useRef<
    (opts: {
      filters?: ColumnFilters;
      phoneQ?: string;
      page?: number;
      replace?: boolean;
    }) => Promise<void>
  >(async () => {});

  const hasMore = items.length < total;
  const filtersActive = hasActiveFilters(filters) || phoneQ.trim().length > 0;

  async function loadList(opts: {
    filters?: ColumnFilters;
    phoneQ?: string;
    page?: number;
    replace?: boolean;
  }) {
    const replace = opts.replace ?? true;
    const nextFilters = opts.filters ?? filtersRef.current;
    const nextPhoneQ = opts.phoneQ !== undefined ? opts.phoneQ : phoneQRef.current;
    const nextPage = opts.page ?? (replace ? 1 : pageRef.current);
    const seq = ++refreshSeq.current;
    inFlightRef.current = true;

    if (replace) {
      setLoading(true);
      loadingMoreRef.current = false;
      setLoadingMore(false);
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    setListError(null);

    try {
      const result = await fetchFreeNumbersList({
        filters: nextFilters,
        phoneQ: nextPhoneQ,
        page: nextPage,
        pageSize: PAGE_SIZE,
      });
      if (seq !== refreshSeq.current) return;

      if (!result.ok) {
        if (replace) {
          setItems([]);
          setTotal(0);
          totalRef.current = 0;
          setPage(1);
        }
        setListError(result.message);
        return;
      }

      if (!replace && result.data.total !== totalRef.current) {
        await loadList({
          filters: nextFilters,
          phoneQ: nextPhoneQ,
          page: 1,
          replace: true,
        });
        return;
      }

      totalRef.current = result.data.total;
      setTotal(result.data.total);
      setPage(result.data.page);
      setItems((prev) => (replace ? result.data.items : [...prev, ...result.data.items]));
      setListError(null);
    } finally {
      if (seq === refreshSeq.current) {
        inFlightRef.current = false;
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }

  useEffect(() => {
    filtersRef.current = filters;
    phoneQRef.current = phoneQ;
    pageRef.current = page;
    totalRef.current = total;
    loadListRef.current = loadList;
  });

  const onLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMoreRef.current || inFlightRef.current) return;
    void loadListRef.current({ page: pageRef.current + 1, replace: false });
  }, [hasMore, loading]);

  const sentinelRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !listError,
    onLoadMore,
    root: scrollRoot,
  });

  function onColumnChange(column: string, values: string[]) {
    const next = setColumnFilterValues(filters, column, values);
    setFilters(next);
    void loadList({ filters: next, page: 1, replace: true });
  }

  function onRemoveFacet(field: string, value: string) {
    const next = removeFacetValue(filters, field, value);
    setFilters(next);
    void loadList({ filters: next, page: 1, replace: true });
  }

  function onPhoneInputChange(value: string) {
    setPhoneInput(value);
    if (phoneSearchTimerRef.current != null) {
      window.clearTimeout(phoneSearchTimerRef.current);
    }
    phoneSearchTimerRef.current = window.setTimeout(() => {
      const next = value.trim();
      setPhoneQ(next);
      void loadList({ phoneQ: next, page: 1, replace: true });
    }, PHONE_SEARCH_DEBOUNCE_MS);
  }

  function onClearPhoneQuery() {
    if (phoneSearchTimerRef.current != null) {
      window.clearTimeout(phoneSearchTimerRef.current);
      phoneSearchTimerRef.current = null;
    }
    setPhoneInput("");
    setPhoneQ("");
    void loadList({ phoneQ: "", page: 1, replace: true });
  }

  function onResetFilters() {
    if (phoneSearchTimerRef.current != null) {
      window.clearTimeout(phoneSearchTimerRef.current);
      phoneSearchTimerRef.current = null;
    }
    setPhoneInput("");
    setPhoneQ("");
    setFilters({});
    setOpenColumn(null);
    void loadList({ filters: {}, phoneQ: "", page: 1, replace: true });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Свободные номера
        </h1>
        <p className="text-muted-foreground text-sm">
          Каталог DID. Поиск номера и фильтры столбцов применяются вместе.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <PhoneSearchInput
          id="free-numbers-phone-search"
          value={phoneInput}
          onChange={onPhoneInputChange}
        />
        <Button
          type="button"
          variant="outline"
          className={FILTER_TOOLBAR_TEXT}
          disabled={!filtersActive}
          onClick={onResetFilters}
        >
          Сбросить фильтры
        </Button>
      </div>

      <ActiveFiltersBar
        filters={filters}
        headers={FREE_NUMBER_HEADERS}
        formatValue={displayFreeNumberFacet}
        phoneQuery={phoneQ}
        onClearPhoneQuery={onClearPhoneQuery}
        onRemoveFacet={onRemoveFacet}
      />

      {listError ? (
        <p className="text-destructive shrink-0 text-sm">{listError}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableInfiniteBody
          scrollRef={setScrollRoot}
          sentinelRef={sentinelRef}
          loadingMore={loadingMore}
        >
          <FreeNumbersTable
            data={items}
            loading={loading && items.length === 0}
            emptyMessage={
              filtersActive
                ? "Нет данных по текущим фильтрам. Сбросьте фильтры или уточните выбор."
                : "Нет данных."
            }
            filters={filters}
            phoneQ={phoneQ}
            openColumn={openColumn}
            onOpenColumnChange={setOpenColumn}
            onColumnFilterChange={onColumnChange}
          />
        </TableInfiniteBody>
        <TableCountFooter shown={items.length} total={total} />
      </div>
    </div>
  );
}
