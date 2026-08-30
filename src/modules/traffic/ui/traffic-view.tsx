"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  currentUtcMonth,
  parseMonthKey,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";
import { formatMonthNominative } from "@/modules/traffic/month-labels";
import type { ListTrafficResult, TrafficListItem } from "@/modules/traffic/service";
import { MonthExportButtons } from "@/modules/traffic/ui/month-export-buttons";
import { TrafficTable } from "@/modules/traffic/ui/traffic-table";
import type { TimeSort } from "@/modules/traffic/traffic-sort";
import {
  composeTrafficBanner,
  displayTrafficFacet,
} from "@/modules/traffic/ui-format";

const PAGE_SIZE = TABLE_PAGE_SIZE;
const PHONE_SEARCH_DEBOUNCE_MS = 300;

type LoadListOpts = {
  page?: number;
  replace?: boolean;
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  phantom?: boolean;
  callErrors?: boolean;
  timeSort?: TimeSort | null;
};

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
  showMonthExport?: boolean;
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
  showMonthExport = false,
  initial,
}: Props) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const [phantom, setPhantom] = useState(false);
  const [callErrors, setCallErrors] = useState(false);
  const [timeSort, setTimeSort] = useState<TimeSort | null>(null);
  const [month, setMonth] = useState(
    initial.month || currentUtcMonth().key,
  );
  const [months, setMonths] = useState<CdrMonth[]>(
    initial.months?.length ? initial.months : [currentUtcMonth()],
  );
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
  const monthRef = useRef(month);
  const loadListRef = useRef<(opts?: LoadListOpts) => Promise<void>>(
    async () => {},
  );
  const phantomRef = useRef(phantom);
  const callErrorsRef = useRef(callErrors);
  const timeSortRef = useRef(timeSort);
  const wasBusyRef = useRef(false);
  const lastFinishedAtRef = useRef<string | null | undefined>(undefined);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  filtersRef.current = filters;
  phoneQRef.current = phoneQ;
  monthRef.current = month;
  phantomRef.current = phantom;
  callErrorsRef.current = callErrors;
  timeSortRef.current = timeSort;

  const defaultMonthKey = currentUtcMonth().key;
  const filtersActive =
    hasActiveFilters(filters) ||
    Boolean(phoneQ.trim()) ||
    phantom ||
    callErrors ||
    timeSort != null ||
    month !== defaultMonthKey;
  const hasMore = items.length < total;
  const monthOptions = useMemo(() => {
    if (months.some((item) => item.key === month)) return months;
    const extra = parseMonthKey(month);
    return extra ? [extra, ...months] : months;
  }, [month, months]);
  const longestMonthLabel = useMemo(
    () =>
      monthOptions
        .map((item) => formatMonthNominative(item.year, item.month))
        .reduce((a, b) => (b.length > a.length ? b : a), "Август 2026 года"),
    [monthOptions],
  );

  const loadList = useCallback(
    async (opts: LoadListOpts = {}) => {
      const replace = opts.replace ?? true;
      const nextFilters = opts.filters ?? filtersRef.current;
      const nextPhoneQ = opts.phoneQ ?? phoneQRef.current;
      const nextMonth = opts.month ?? monthRef.current;
      const nextPhantom = opts.phantom ?? phantomRef.current;
      const nextCallErrors = opts.callErrors ?? callErrorsRef.current;
      const nextTimeSort =
        "timeSort" in opts ? opts.timeSort : timeSortRef.current;
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
        month: nextMonth,
        phantom: nextPhantom,
        callErrors: nextCallErrors,
        timeSort: nextTimeSort,
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
      if (result.data.months) setMonths(result.data.months);
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    },
    [page],
  );
  loadListRef.current = loadList;

  useEffect(() => {
    const t = setTimeout(() => {
      if (phoneInput === phoneQ) return;
      setPhoneQ(phoneInput);
      void loadList({ page: 1, replace: true, phoneQ: phoneInput });
    }, PHONE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [phoneInput, phoneQ, loadList]);

  const applyStatusBanner = useCallback(
    (status: {
      lastError: string | null;
      pendingInboxCount?: number;
      poisonedCount?: number;
      runningCount: number;
    }) => {
      setBannerError(
        composeTrafficBanner({
          lastError: status.lastError,
          pendingInboxCount: status.pendingInboxCount ?? 0,
          poisonedCount: status.poisonedCount ?? 0,
          runningCount: status.runningCount,
        }),
      );
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const isBusy = (data: {
      pendingInboxCount?: number;
      runningCount: number;
    }) => (data.pendingInboxCount ?? 0) > 0 || data.runningCount > 0;

    const pull = async () => {
      const status = await fetchTrafficStatus();
      if (cancelled || !status.ok) return;
      applyStatusBanner(status.data);
      const busy = isBusy(status.data);
      const finishedAt = status.data.lastFinishedAt ?? null;
      const finishedChanged =
        lastFinishedAtRef.current !== undefined &&
        lastFinishedAtRef.current !== finishedAt;
      if ((wasBusyRef.current && !busy) || finishedChanged) {
        void loadListRef.current({ page: 1, replace: true });
      }
      wasBusyRef.current = busy;
      lastFinishedAtRef.current = finishedAt;
    };

    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      if (cancelled || timer != null) return;
      timer = window.setInterval(() => {
        void pull();
      }, 4000);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      void pull();
      start();
    };

    void pull();
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [applyStatusBanner]);

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

  function onMonthChange(nextKey: string) {
    const parsed = parseMonthKey(nextKey);
    if (!parsed) return;
    setMonth(parsed.key);
    setFilters({});
    setOpenColumn(null);
    setTimeSort(null);
    void loadList({
      page: 1,
      replace: true,
      month: parsed.key,
      filters: {},
      timeSort: null,
    });
  }

  function onResetFilters() {
    const nowMonth = currentUtcMonth();
    setFilters({});
    setPhoneInput("");
    setPhoneQ("");
    setPhantom(false);
    setCallErrors(false);
    setTimeSort(null);
    setMonth(nowMonth.key);
    setOpenColumn(null);
    void loadList({
      page: 1,
      replace: true,
      filters: {},
      phoneQ: "",
      phantom: false,
      callErrors: false,
      timeSort: null,
      month: nowMonth.key,
    });
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

  function onPhantomChange(checked: boolean) {
    setPhantom(checked);
    void loadList({ page: 1, replace: true, phantom: checked });
  }

  function onCallErrorsChange(checked: boolean) {
    setCallErrors(checked);
    void loadList({ page: 1, replace: true, callErrors: checked });
  }

  function onTimeSortChange(next: TimeSort | null) {
    setTimeSort(next);
    void loadList({ page: 1, replace: true, timeSort: next });
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
        const after = await fetchTrafficStatus();
        if (after.ok) applyStatusBanner(after.data);
        else setBannerError(null);
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
        <div className="flex flex-wrap items-center gap-2">
          {showMonthExport ? <MonthExportButtons month={month} /> : null}
          {showRetry ? (
            <Button type="button" onClick={() => void onRetry()} disabled={pending}>
              {pending ? "Импорт…" : "Повторить импорт"}
            </Button>
          ) : null}
        </div>
      </div>

      {bannerError ? (
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

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
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
          <div className="flex items-center gap-2">
            <input
              id={`${searchInputId}-phantom`}
              type="checkbox"
              className="size-4 rounded border"
              checked={phantom}
              onChange={(e) => onPhantomChange(e.target.checked)}
            />
            <Label htmlFor={`${searchInputId}-phantom`}>Фантомный трафик</Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={`${searchInputId}-call-errors`}
              type="checkbox"
              className="size-4 rounded border"
              checked={callErrors}
              onChange={(e) => onCallErrorsChange(e.target.checked)}
            />
            <Label htmlFor={`${searchInputId}-call-errors`}>Ошибки звонков</Label>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!filtersActive}
            onClick={onResetFilters}
          >
            Сбросить фильтры
          </Button>
        </div>
        <div className="relative inline-grid">
          <select
            id={`${searchInputId}-month`}
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            aria-label="Календарный месяц"
            className="col-start-1 row-start-1 h-8 w-full rounded-lg border border-border bg-background py-0 pl-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {monthOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {formatMonthNominative(item.year, item.month)}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            className="invisible col-start-1 row-start-1 h-8 whitespace-nowrap border border-transparent py-0 pl-2.5 pr-8 text-sm"
          >
            {longestMonthLabel}
          </span>
        </div>
      </div>

      <ActiveFiltersBar
        filters={filters}
        headers={headerLabels}
        formatValue={displayTrafficFacet}
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
            month={month}
            phantom={phantom}
            callErrors={callErrors}
            openColumn={openColumn}
            onOpenColumnChange={setOpenColumn}
            onColumnFilterChange={onColumnChange}
            timeSort={timeSort}
            onTimeSortChange={onTimeSortChange}
          />
        </TableInfiniteBody>
        <TableCountFooter shown={items.length} total={total} />
      </div>
    </div>
  );
}
