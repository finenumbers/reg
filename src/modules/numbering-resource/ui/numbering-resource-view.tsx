"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActiveFiltersBar,
  hasActiveFilters,
  removeFacetValue,
  setColumnFilterValues,
  type ColumnFilters,
} from "@/components/column-filters";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { TableCountFooter, TableInfiniteBody } from "@/components/table-infinite-body";
import { Button } from "@/components/ui/button";
import { useFilteredExport } from "@/components/filtered-export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { formatCount } from "@/lib/format-count";
import {
  fetchNumberingList,
  fetchNumberingSummary,
} from "@/modules/numbering-resource/api-client";
import { NUMBERING_HEADERS } from "@/modules/numbering-resource/columns";
import {
  emptyPhoneMask,
  formatDatasetDate,
  formatPhoneMaskHint,
  phoneMaskHasDigit,
} from "@/modules/numbering-resource/format";
import type {
  ListNumberingResult,
  NumberingSummary,
} from "@/modules/numbering-resource/types";
import { PhoneMaskInput } from "@/modules/numbering-resource/ui/phone-mask-input";
import { NumberingResourceTable } from "@/modules/numbering-resource/ui/numbering-resource-table";

const PHONE_DEBOUNCE_MS = 500;

type Props = {
  initial: ListNumberingResult;
  initialError: string | null;
  initialSummary: NumberingSummary | null;
  initialSummaryError: string | null;
};

function KpiValue({
  active,
  filtered,
  global,
  pending = false,
}: {
  active: boolean;
  filtered: number;
  global: number;
  pending?: boolean;
}) {
  if (!active) {
    return (
      <p className="text-base leading-tight font-semibold tabular-nums">
        {formatCount(global)}
      </p>
    );
  }
  return (
    <p className="text-base leading-tight font-semibold tabular-nums">
      <span className="rounded-sm bg-yellow-200/80 px-1 text-black">
        {pending ? "…" : formatCount(filtered)}
      </span>
      <span className="text-muted-foreground"> / </span>
      <span>{formatCount(global)}</span>
    </p>
  );
}

export function NumberingResourceView({
  initial,
  initialError,
  initialSummary,
  initialSummaryError,
}: Props) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [phoneInput, setPhoneInput] = useState(emptyPhoneMask);
  const [phoneQ, setPhoneQ] = useState("");
  const [openColumn, setOpenColumn] = useState<string | null>(null);
  const [items, setItems] = useState(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(initialError);
  const [summary, setSummary] = useState(initialSummary);
  const [datasetLoadedAt, setDatasetLoadedAt] = useState<string | null>(
    initialSummary?.loadedAt ?? null,
  );
  const [summaryError, setSummaryError] = useState<string | null>(initialSummaryError);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  const filtersRef = useRef(filters);
  const phoneQRef = useRef(phoneQ);
  const cursorRef = useRef(initial.nextCursor);
  const hasMoreRef = useRef(initial.hasMore);
  const listBusyRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const listSeq = useRef(0);
  const summarySeq = useRef(0);
  const listAbort = useRef<AbortController | null>(null);
  const summaryAbort = useRef<AbortController | null>(null);
  const phoneTimer = useRef<number | null>(null);

  filtersRef.current = filters;
  phoneQRef.current = phoneQ;

  const filtersActive = hasActiveFilters(filters) || phoneMaskHasDigit(phoneQ);
  const canReset = filtersActive || phoneMaskHasDigit(phoneInput);

  const applyList = useCallback((data: ListNumberingResult, replace: boolean) => {
    if (!replace && data.items.length === 0) {
      hasMoreRef.current = false;
      cursorRef.current = null;
      setHasMore(false);
      return;
    }
    if (replace) {
      setItems(data.items);
      setTotal(data.total);
    } else {
      setItems((prev) => [...prev, ...data.items]);
      if (data.total > 0) setTotal(data.total);
    }
    hasMoreRef.current = data.hasMore;
    cursorRef.current = data.nextCursor;
    setHasMore(data.hasMore);
  }, []);

  const loadList = useCallback(
    async (opts: { filters: ColumnFilters; phoneQ: string; replace: boolean }) => {
      const seq = ++listSeq.current;
      listAbort.current?.abort();
      const ac = new AbortController();
      listAbort.current = ac;
      const cursor = opts.replace ? null : cursorRef.current;
      listBusyRef.current = true;
      if (opts.replace) {
        loadingMoreRef.current = false;
        hasMoreRef.current = false;
        setItems([]);
        setHasMore(false);
        setLoadingMore(false);
        setLoading(true);
      } else {
        loadingMoreRef.current = true;
        setLoadingMore(true);
      }
      setListError(null);
      try {
        const result = await fetchNumberingList(
          { filters: opts.filters, phoneQ: opts.phoneQ, cursor },
          ac.signal,
        );
        if (seq !== listSeq.current) return;
        if (!result.ok) {
          if (result.aborted) return;
          if (opts.replace) {
            setItems([]);
            setTotal(0);
            hasMoreRef.current = false;
            cursorRef.current = null;
            setHasMore(false);
          }
          setListError(result.message);
          return;
        }
        applyList(result.data, opts.replace);
        setListError(null);
      } finally {
        if (seq === listSeq.current) {
          listBusyRef.current = false;
          loadingMoreRef.current = false;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [applyList],
  );

  const loadSummary = useCallback(
    async (nextFilters: ColumnFilters, nextPhone: string) => {
      const seq = ++summarySeq.current;
      summaryAbort.current?.abort();
      const ac = new AbortController();
      summaryAbort.current = ac;
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const result = await fetchNumberingSummary(
          { filters: nextFilters, phoneQ: nextPhone },
          ac.signal,
        );
        if (seq !== summarySeq.current) return;
        if (!result.ok) {
          if (result.aborted) return;
          setSummary(null);
          setSummaryError(result.message);
          return;
        }
        setSummary(result.data);
        setDatasetLoadedAt(result.data.loadedAt);
        setSummaryError(null);
      } finally {
        if (seq === summarySeq.current) setSummaryLoading(false);
      }
    },
    [],
  );

  const reload = useCallback(
    (nextFilters: ColumnFilters, nextPhone: string) => {
      void loadList({ filters: nextFilters, phoneQ: nextPhone, replace: true });
      void loadSummary(nextFilters, nextPhone);
    },
    [loadList, loadSummary],
  );

  useEffect(() => {
    return () => {
      if (phoneTimer.current != null) window.clearTimeout(phoneTimer.current);
      listAbort.current?.abort();
      summaryAbort.current?.abort();
    };
  }, []);

  const onLoadMore = useCallback(() => {
    if (!hasMoreRef.current || listBusyRef.current || loadingMoreRef.current) return;
    void loadList({
      filters: filtersRef.current,
      phoneQ: phoneQRef.current,
      replace: false,
    });
  }, [loadList]);

  const sentinelRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !listError,
    onLoadMore,
    root: scrollRoot,
  });

  function onColumnChange(column: string, values: string[]) {
    const next = setColumnFilterValues(filters, column, values);
    setFilters(next);
    reload(next, phoneQ);
  }

  function onRemoveFacet(field: string, value: string) {
    const next = removeFacetValue(filters, field, value);
    setFilters(next);
    reload(next, phoneQ);
  }

  function onPhoneInputChange(value: string) {
    setPhoneInput(value);
    if (phoneTimer.current != null) window.clearTimeout(phoneTimer.current);
    phoneTimer.current = window.setTimeout(() => {
      const next = phoneMaskHasDigit(value) ? value : "";
      setPhoneQ(next);
      reload(filtersRef.current, next);
    }, PHONE_DEBOUNCE_MS);
  }

  function onClearPhoneQuery() {
    if (phoneTimer.current != null) window.clearTimeout(phoneTimer.current);
    setPhoneInput(emptyPhoneMask());
    setPhoneQ("");
    reload(filters, "");
  }

  function onResetFilters() {
    if (phoneTimer.current != null) window.clearTimeout(phoneTimer.current);
    setPhoneInput(emptyPhoneMask());
    setPhoneQ("");
    setFilters({});
    setOpenColumn(null);
    reload({}, "");
  }

  const emptyMessage = filtersActive
    ? "Нет данных по текущим фильтрам. Сбросьте фильтры или уточните выбор."
    : summary && summary.global.rangeCount === 0
      ? "Данные ещё не загружены."
      : "Нет данных.";

  const phoneChip = phoneMaskHasDigit(phoneQ) ? formatPhoneMaskHint(phoneQ) : "";
  const exportTotalKnown = !summaryLoading && summary != null;
  const exportTotal = summary
    ? filtersActive
      ? summary.filtered.rangeCount
      : summary.global.rangeCount
    : null;
  const exportUi = useFilteredExport({
    endpoint: "/api/numbering-resource/export",
    filters,
    phoneQ,
    totalRows: exportTotal,
    totalKnown: exportTotalKnown,
  });

  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-col gap-4">
      <div className="flex w-full min-w-0 shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
            Ресурс нумерации
          </h1>
          <p className="text-muted-foreground text-sm">
            Текущая нумерация. Фильтры столбцов и поиск номера применяются вместе.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <PhoneMaskInput value={phoneInput} onChange={onPhoneInputChange} />
          <Button
            type="button"
            variant="outline"
            className={FILTER_TOOLBAR_TEXT}
            disabled={!canReset}
            onClick={onResetFilters}
          >
            Сбросить фильтры
          </Button>
          {exportUi.button}
        </div>
      </div>
      {exportUi.banner}

      <div className="grid w-full min-w-0 shrink-0 grid-cols-1 gap-3 @min-[40rem]:grid-cols-2 @min-[56rem]:grid-cols-5">
        <KpiCard title="Найденные диапазоны" loading={summaryLoading}>
          {summary ? (
            <KpiValue
              active={filtersActive}
              filtered={summary.filtered.rangeCount}
              global={summary.global.rangeCount}
            />
          ) : (
            <p className="text-base leading-tight font-semibold">—</p>
          )}
        </KpiCard>
        <KpiCard title="Операторы связи" loading={summaryLoading}>
          {summary ? (
            <KpiValue
              active={filtersActive}
              filtered={summary.filtered.uniqueOperators}
              global={summary.global.uniqueOperators}
            />
          ) : (
            <p className="text-base leading-tight font-semibold">—</p>
          )}
        </KpiCard>
        <KpiCard title="Территории ГАР" loading={summaryLoading}>
          {summary ? (
            <KpiValue
              active={filtersActive}
              filtered={summary.filtered.uniqueGarTerritories}
              global={summary.global.uniqueGarTerritories}
            />
          ) : (
            <p className="text-base leading-tight font-semibold">—</p>
          )}
        </KpiCard>
        <KpiCard title="Суммарная ёмкость" loading={summaryLoading}>
          {summary ? (
            <KpiValue
              active={filtersActive}
              filtered={summary.filtered.totalCapacity}
              global={summary.global.totalCapacity}
              pending={filtersActive && summary.filtered.totalCapacityPending}
            />
          ) : (
            <p className="text-base leading-tight font-semibold">—</p>
          )}
        </KpiCard>
        <KpiCard title="Дата датасета" loading={false}>
          <p className="text-base leading-tight font-semibold tabular-nums">
            {formatDatasetDate(datasetLoadedAt)}
          </p>
        </KpiCard>
      </div>

      {summaryError ? (
        <p className="text-destructive shrink-0 text-sm">{summaryError}</p>
      ) : null}

      <ActiveFiltersBar
        filters={filters}
        headers={NUMBERING_HEADERS}
        phoneQuery={phoneChip}
        onClearPhoneQuery={onClearPhoneQuery}
        onRemoveFacet={onRemoveFacet}
      />

      {listError ? (
        <p className="text-destructive shrink-0 text-sm">
          {listError}
          {hasMore && items.length > 0 ? (
            <>
              {" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={onLoadMore}
              >
                Повторить
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableInfiniteBody
          scrollRef={setScrollRoot}
          sentinelRef={sentinelRef}
          loadingMore={loadingMore}
        >
          <NumberingResourceTable
            data={items}
            loading={loading && items.length === 0}
            emptyMessage={emptyMessage}
            filters={filters}
            phoneQ={phoneQ}
            openColumn={openColumn}
            onOpenColumnChange={setOpenColumn}
            onColumnFilterChange={onColumnChange}
          />
        </TableInfiniteBody>
        {total < 0 ? (
          <div className="border-border/60 text-muted-foreground shrink-0 border-t pt-3 text-xs">
            <p>
              {items.length === 0
                ? "0 результатов"
                : `Показано ${formatCount(items.length)}+`}
            </p>
          </div>
        ) : (
          <TableCountFooter shown={items.length} total={total} />
        )}
      </div>
    </div>
  );
}

function KpiCard({
  title,
  loading,
  children,
}: {
  title: string;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="min-w-0 gap-0!">
      <CardHeader className="pb-1">
        <CardTitle className="text-muted-foreground text-xs font-medium">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-base leading-tight font-semibold">…</p> : children}
      </CardContent>
    </Card>
  );
}
