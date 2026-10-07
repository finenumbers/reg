"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FitSelect } from "@/components/fit-select";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { PhoneSearchInput } from "@/components/phone-search-input";
import { RowColorMark } from "@/components/row-color-legend";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { formatMonthOption } from "@/modules/traffic/month-labels";
import type { ListTrafficResult, TrafficListItem } from "@/modules/traffic/service";
import { MonthExportButtons } from "@/modules/traffic/ui/month-export-buttons";
import { TrafficTable } from "@/modules/traffic/ui/traffic-table";
import type { TimeSort } from "@/modules/traffic/traffic-sort";
import { composeTrafficBanner, displayTrafficFacet } from "@/modules/traffic/ui-format";

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
  parking?: boolean;
  failed?: boolean;
  check?: boolean;
  success?: boolean;
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
  boldColumns?: readonly string[];
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
  boldColumns,
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
  const [parking, setParking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [check, setCheck] = useState(false);
  const [success, setSuccess] = useState(false);
  const [timeSort, setTimeSort] = useState<TimeSort | null>(null);
  const [month, setMonth] = useState(initial.month || currentUtcMonth().key);
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
  const [poisonFiles, setPoisonFiles] = useState<
    Array<{ filename: string; error: string; heldForPurge: boolean }>
  >([]);
  const [syncState, setSyncState] = useState<SyncUiState>(IDLE_SYNC_STATE);
  const syncInFlightRef = useRef(false);
  const refreshSeq = useRef(0);
  const loadingMoreRef = useRef(false);
  const filtersRef = useRef(filters);
  const phoneQRef = useRef(phoneQ);
  const monthRef = useRef(month);
  const loadListRef = useRef<(opts?: LoadListOpts) => Promise<void>>(async () => {});
  const phantomRef = useRef(phantom);
  const callErrorsRef = useRef(callErrors);
  const parkingRef = useRef(parking);
  const failedRef = useRef(failed);
  const checkRef = useRef(check);
  const successRef = useRef(success);
  const timeSortRef = useRef(timeSort);
  const wasBusyRef = useRef(false);
  const lastFinishedAtRef = useRef<string | null | undefined>(undefined);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  filtersRef.current = filters;
  phoneQRef.current = phoneQ;
  monthRef.current = month;
  phantomRef.current = phantom;
  callErrorsRef.current = callErrors;
  parkingRef.current = parking;
  failedRef.current = failed;
  checkRef.current = check;
  successRef.current = success;
  timeSortRef.current = timeSort;

  const defaultMonthKey = currentUtcMonth().key;
  const filtersActive =
    hasActiveFilters(filters) ||
    Boolean(phoneQ.trim()) ||
    phantom ||
    callErrors ||
    parking ||
    failed ||
    check ||
    success ||
    timeSort != null ||
    month !== defaultMonthKey;
  const hasMore = items.length < total;
  const monthOptions = useMemo(() => {
    if (months.some((item) => item.key === month)) return months;
    const extra = parseMonthKey(month);
    return extra ? [extra, ...months] : months;
  }, [month, months]);
  const monthSelectOptions = useMemo(
    () =>
      monthOptions.map((item) => ({
        value: item.key,
        label: formatMonthOption(item.year, item.month, item.count),
      })),
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
      const nextParking = opts.parking ?? parkingRef.current;
      const nextFailed = opts.failed ?? failedRef.current;
      const nextCheck = opts.check ?? checkRef.current;
      const nextSuccess = opts.success ?? successRef.current;
      const nextTimeSort = "timeSort" in opts ? opts.timeSort : timeSortRef.current;
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
        parking: nextParking,
        failed: nextFailed,
        check: nextCheck,
        success: nextSuccess,
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

      setItems((prev) => (replace ? result.data.items : [...prev, ...result.data.items]));
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
      poisonFiles?: Array<{
        filename: string;
        error: string;
        heldForPurge: boolean;
      }>;
    }) => {
      setPoisonFiles(status.poisonFiles ?? []);
      setBannerError(
        composeTrafficBanner({
          lastError: status.lastError,
          pendingInboxCount: status.pendingInboxCount ?? 0,
          poisonedCount: status.poisonedCount ?? 0,
          runningCount: status.runningCount,
          poisonFiles: status.poisonFiles,
          detailOnRaw: showOps,
        }),
      );
    },
    [showOps],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const isBusy = (data: { pendingInboxCount?: number; runningCount: number }) =>
      (data.pendingInboxCount ?? 0) > 0 || data.runningCount > 0;

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
    setParking(false);
    setFailed(false);
    setCheck(false);
    setSuccess(false);
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
      parking: false,
      failed: false,
      check: false,
      success: false,
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

  function onParkingChange(checked: boolean) {
    setParking(checked);
    void loadList({ page: 1, replace: true, parking: checked });
  }

  function onFailedChange(checked: boolean) {
    setFailed(checked);
    void loadList({ page: 1, replace: true, failed: checked });
  }

  function onCheckChange(checked: boolean) {
    setCheck(checked);
    void loadList({ page: 1, replace: true, check: checked });
  }

  function onSuccessChange(checked: boolean) {
    setSuccess(checked);
    void loadList({ page: 1, replace: true, success: checked });
  }

  function onTimeSortChange(next: TimeSort | null) {
    const prev = timeSort;
    setTimeSort(next);
    // desc matches the default server ORDER BY — do not refetch the list.
    if (prev == null && next === "desc") return;
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
          <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
            {title}
          </h1>
          <p className="text-muted-foreground text-sm">{subtitle}</p>
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
          className="border-destructive/30 bg-destructive/10 text-destructive shrink-0 rounded-md border px-3 py-2 text-sm"
        >
          {bannerError}
        </div>
      ) : null}

      {showOps && poisonFiles.length > 0 ? (
        <ul
          className="border-destructive/30 bg-destructive/10 text-destructive shrink-0 list-none space-y-1 rounded-md border px-3 py-2 text-sm"
          aria-label="Файлы с ошибкой импорта"
        >
          {poisonFiles.map((file) => (
            <li key={file.filename}>
              <span className="font-medium">{file.filename}</span>
              {": "}
              {file.error}
            </li>
          ))}
        </ul>
      ) : null}

      {listError ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive shrink-0 rounded-md border px-3 py-2 text-sm"
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
              : "border-destructive/30 bg-destructive/10 text-destructive shrink-0 rounded-md border px-3 py-2 text-sm"
          }
        >
          {syncState.message}
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <PhoneSearchInput
            id={searchInputId}
            value={phoneInput}
            onChange={setPhoneInput}
          />
          <div className="flex items-center gap-2">
            <input
              id={`${searchInputId}-phantom`}
              type="checkbox"
              className="size-4 rounded border"
              checked={phantom}
              onChange={(e) => onPhantomChange(e.target.checked)}
            />
            <Label htmlFor={`${searchInputId}-phantom`}>
              <RowColorMark tone="phantom">Фантомный</RowColorMark>
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={`${searchInputId}-call-errors`}
              type="checkbox"
              className="size-4 rounded border"
              checked={callErrors}
              onChange={(e) => onCallErrorsChange(e.target.checked)}
            />
            <Label htmlFor={`${searchInputId}-call-errors`}>
              <RowColorMark tone="call_error">Ошибки звонков</RowColorMark>
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={`${searchInputId}-parking`}
              type="checkbox"
              className="size-4 rounded border"
              checked={parking}
              onChange={(e) => onParkingChange(e.target.checked)}
            />
            <Label htmlFor={`${searchInputId}-parking`}>
              <RowColorMark tone="parking_known">Паркинг</RowColorMark>
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={`${searchInputId}-check`}
              type="checkbox"
              className="size-4 rounded border"
              checked={check}
              onChange={(e) => onCheckChange(e.target.checked)}
            />
            <Label htmlFor={`${searchInputId}-check`}>
              <RowColorMark tone="check">Проверка</RowColorMark>
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={`${searchInputId}-failed`}
              type="checkbox"
              className="size-4 rounded border"
              checked={failed}
              onChange={(e) => onFailedChange(e.target.checked)}
            />
            <Label htmlFor={`${searchInputId}-failed`}>
              <RowColorMark tone="failed">Неуспешные</RowColorMark>
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={`${searchInputId}-success`}
              type="checkbox"
              className="size-4 rounded border"
              checked={success}
              onChange={(e) => onSuccessChange(e.target.checked)}
            />
            <Label htmlFor={`${searchInputId}-success`} className={FILTER_TOOLBAR_TEXT}>
              Успешные
            </Label>
          </div>
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
        <FitSelect
          id={`${searchInputId}-month`}
          value={month}
          options={monthSelectOptions}
          onChange={onMonthChange}
          aria-label="Календарный месяц"
          textClassName={FILTER_TOOLBAR_TEXT}
        />
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
            boldColumns={boldColumns}
            data={items}
            loading={loading && items.length === 0}
            emptyMessage={filtersActive ? FILTERED_EMPTY : emptyUnfiltered}
            filters={filters}
            phoneQ={phoneQ}
            month={month}
            phantom={phantom}
            callErrors={callErrors}
            parking={parking}
            failed={failed}
            check={check}
            success={success}
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
