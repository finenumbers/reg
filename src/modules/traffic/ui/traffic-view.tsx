"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ActiveFiltersBar,
  hasActiveFilters,
  removeFacetValue,
  setColumnFilterValues,
  type ColumnFilters,
} from "@/components/column-filters";
import {
  TableCountFooter,
  TableInfiniteBody,
} from "@/components/table-infinite-body";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import {
  fetchTrafficList,
  fetchTrafficStatus,
  postTrafficRetry,
} from "@/modules/traffic/api-client";
import {
  IDLE_SYNC_STATE,
  isSyncInFlight,
  reduceSyncUiState,
  waitForPhonesSyncOutcome,
  type SyncUiState,
} from "@/modules/phones/request-action";
import type { ListTrafficResult, TrafficListItem } from "@/modules/traffic/service";
import { TrafficTable } from "@/modules/traffic/ui/traffic-table";

const PAGE_SIZE = TABLE_PAGE_SIZE;
const PHONE_SEARCH_DEBOUNCE_MS = 300;

const FILTERED_EMPTY =
  "Нет данных по текущим фильтрам. Сбросьте фильтры или уточните выбор.";

type Props = {
  title: string;
  subtitle: string;
  searchInputId: string;
  columns: readonly string[];
  headerLabels: Record<string, string>;
  highlightColumns?: readonly string[];
  showOps: boolean;
  canRetry: boolean;
  emptyUnfiltered: string;
  initial: ListTrafficResult;
};

export function TrafficView({
  title,
  subtitle,
  searchInputId,
  columns,
  headerLabels,
  highlightColumns,
  showOps,
  canRetry,
  emptyUnfiltered,
  initial,
}: Props) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const [openColumn, setOpenColumn] = useState<string | null>(null);
  const [page, setPage] = useState(initial.page);
  const [items, setItems] = useState<TrafficListItem[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncUiState>(IDLE_SYNC_STATE);
  const syncInFlightRef = useRef(false);
  const refreshSeq = useRef(0);
  const loadingMoreRef = useRef(false);
  const filtersRef = useRef(filters);
  const phoneQRef = useRef(phoneQ);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  filtersRef.current = filters;
  phoneQRef.current = phoneQ;

  const filtersActive = hasActiveFilters(filters) || Boolean(phoneQ.trim());
  const hasMore = items.length < total;

  const loadList = useCallback(
    async (
      opts: {
        page?: number;
        replace?: boolean;
        filters?: ColumnFilters;
        phoneQ?: string;
      } = {},
    ) => {
      const replace = opts.replace ?? true;
      const nextFilters = opts.filters ?? filtersRef.current;
      const nextPhoneQ = opts.phoneQ ?? phoneQRef.current;
      const nextPage = opts.page ?? (replace ? 1 : page);
      const seq = ++refreshSeq.current;

      if (replace) {
        setLoading(true);
        loadingMoreRef.current = false;
        setLoadingMore(false);
      } else {
        loadingMoreRef.current = true;
        setLoadingMore(true);
      }
      setListError(null);

      const result = await fetchTrafficList({
        filters: nextFilters,
        phoneQ: nextPhoneQ,
        page: nextPage,
        pageSize: PAGE_SIZE,
      });
      if (seq !== refreshSeq.current) return;

      if (!result.ok) {
        setListError(result.message);
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
        return;
      }

      setItems((prev) =>
        replace ? result.data.items : [...prev, ...result.data.items],
      );
      setTotal(result.data.total);
      setPage(result.data.page);
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    },
    [page],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if (phoneInput === phoneQ) return;
      setPhoneQ(phoneInput);
      void loadList({ page: 1, replace: true, phoneQ: phoneInput });
    }, PHONE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [phoneInput, phoneQ, loadList]);

  useEffect(() => {
    if (!showOps) return;
    void (async () => {
      const status = await fetchTrafficStatus();
      if (status.ok && status.data.lastError) {
        setBannerError(status.data.lastError);
      }
    })();
  }, [showOps]);

  const onLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMoreRef.current) return;
    void loadList({ page: page + 1, replace: false });
  }, [hasMore, loading, loadList, page]);

  const sentinelRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !listError,
    onLoadMore,
    root: scrollRoot,
  });

  function onColumnChange(column: string, values: string[]) {
    const next = setColumnFilterValues(filters, column, values);
    setFilters(next);
    void loadList({ page: 1, replace: true, filters: next });
  }

  function onResetFilters() {
    setFilters({});
    setPhoneInput("");
    setPhoneQ("");
    void loadList({ page: 1, replace: true, filters: {}, phoneQ: "" });
  }

  function onRemoveFacet(column: string, value: string) {
    const next = removeFacetValue(filters, column, value);
    setFilters(next);
    void loadList({ page: 1, replace: true, filters: next });
  }

  function onClearPhoneQuery() {
    setPhoneInput("");
    setPhoneQ("");
    void loadList({ page: 1, replace: true, phoneQ: "" });
  }

  async function onRetry() {
    if (!showOps || !canRetry || syncInFlightRef.current || isSyncInFlight(syncState)) {
      return;
    }
    syncInFlightRef.current = true;
    setSyncState(reduceSyncUiState(syncState, { type: "START" }));
    try {
      const before = await fetchTrafficStatus();
      const beforeFinishedAt = before.ok ? before.data.lastFinishedAt : null;
      const enqueued = await postTrafficRetry();
      if (!enqueued.ok) {
        const next = reduceSyncUiState(IDLE_SYNC_STATE, {
          type: "ERROR",
          message: enqueued.message,
          conflict: enqueued.conflict,
        });
        setSyncState(next);
        toast.error(enqueued.message);
        return;
      }
      const outcome = await waitForPhonesSyncOutcome({
        beforeFinishedAt,
        fetchStatus: async () => {
          const status = await fetchTrafficStatus();
          if (!status.ok) throw new Error(status.message);
          return {
            lastJobStatus: status.data.lastJobStatus,
            lastError: status.data.lastError,
            lastFinishedAt: status.data.lastFinishedAt,
            runningCount: status.data.runningCount,
            lastFailedError: status.data.lastFailedError,
          };
        },
      });
      if (outcome.ok) {
        setBannerError(null);
        setSyncState(
          reduceSyncUiState(IDLE_SYNC_STATE, {
            type: "SUCCESS",
            message: outcome.message,
          }),
        );
        toast.success(outcome.message);
        await loadList({ page: 1, replace: true });
      } else {
        setBannerError(outcome.message);
        setSyncState(
          reduceSyncUiState(IDLE_SYNC_STATE, {
            type: "ERROR",
            message: outcome.message,
          }),
        );
        toast.error(outcome.message);
      }
    } catch {
      const message = "Не удалось повторить импорт";
      setSyncState(reduceSyncUiState(IDLE_SYNC_STATE, { type: "ERROR", message }));
      toast.error(message);
    } finally {
      syncInFlightRef.current = false;
    }
  }

  const pending = isSyncInFlight(syncState);
  const showRetry = showOps && canRetry;
  const showSyncBanner =
    showOps &&
    (syncState.status === "success" ||
      syncState.status === "error" ||
      syncState.status === "conflict");

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {showRetry ? (
          <Button type="button" onClick={() => void onRetry()} disabled={pending}>
            {pending ? "Импорт…" : "Повторить импорт"}
          </Button>
        ) : null}
      </div>

      {showOps && bannerError ? (
        <div
          role="alert"
          className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {bannerError}
        </div>
      ) : null}

      {listError ? (
        <div
          role="alert"
          className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {listError}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-3"
            onClick={() => void loadList({ page: 1, replace: true })}
          >
            Повторить
          </Button>
        </div>
      ) : null}

      {showSyncBanner ? (
        <div
          role="status"
          className={
            syncState.status === "success"
              ? "shrink-0 rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200"
              : "shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
        >
          {syncState.message}
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Input
          id={searchInputId}
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          placeholder="Телефонный номер"
          aria-label="Телефонный номер"
          size={19}
          className="w-[calc(17ch+1.25rem)] shrink-0"
          autoComplete="off"
        />
        <Button
          type="button"
          variant="outline"
          disabled={!filtersActive}
          onClick={onResetFilters}
        >
          Сбросить фильтры
        </Button>
      </div>

      <ActiveFiltersBar
        filters={filters}
        headers={headerLabels}
        phoneQuery={phoneQ}
        onClearPhoneQuery={onClearPhoneQuery}
        onRemoveFacet={onRemoveFacet}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableInfiniteBody
          scrollRef={setScrollRoot}
          sentinelRef={sentinelRef}
          loadingMore={loadingMore}
        >
          <TrafficTable
            headers={[...columns]}
            headerLabels={headerLabels}
            highlightColumns={highlightColumns}
            data={items}
            loading={loading && items.length === 0}
            emptyMessage={filtersActive ? FILTERED_EMPTY : emptyUnfiltered}
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
