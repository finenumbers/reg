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
  downloadRegsExport,
  fetchRegsDetail,
  fetchRegsList,
  fetchRegsStatus,
  postRegsPoll,
  toPollStatusSnapshot,
} from "@/modules/registrations/api-client";
import {
  IDLE_POLL_STATE,
  isPollInFlight,
  reducePollUiState,
  waitForRegsPollOutcome,
  type PollUiState,
} from "@/modules/registrations/poll-action";
import type { RegistrationListItem } from "@/modules/registrations/types";
import type {
  ListRegistrationsResult,
  RegistrationDetailResult,
} from "@/modules/registrations/service";
import {
  displayFacetForColumn,
  REG_COLUMN_HEADERS,
} from "@/modules/registrations/ui-format";
import { RegsDetailSheet } from "@/modules/registrations/ui/regs-detail-sheet";
import { RegsTable } from "@/modules/registrations/ui/regs-table";

const PAGE_SIZE = TABLE_PAGE_SIZE;
const PHONE_SEARCH_DEBOUNCE_MS = 300;

type Props = {
  canPoll: boolean;
  initial: ListRegistrationsResult;
};

export function RegistrationsView({ canPoll, initial }: Props) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const [openColumn, setOpenColumn] = useState<string | null>(null);
  const [page, setPage] = useState(initial.page);
  const [items, setItems] = useState(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RegistrationDetailResult | null>(null);
  const [pollState, setPollState] = useState<PollUiState>(IDLE_POLL_STATE);
  const [exporting, setExporting] = useState(false);
  const pollInFlightRef = useRef(false);
  const detailAbortRef = useRef<AbortController | null>(null);
  const refreshSeq = useRef(0);
  const loadingMoreRef = useRef(false);
  const filtersRef = useRef(filters);
  const phoneQRef = useRef(phoneQ);
  const phoneSearchTimerRef = useRef<number | null>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  filtersRef.current = filters;
  phoneQRef.current = phoneQ;

  const hasMore = items.length < total;
  const filtersActive = hasActiveFilters(filters) || phoneQ.trim().length > 0;

  useEffect(() => {
    return () => {
      if (phoneSearchTimerRef.current != null) {
        window.clearTimeout(phoneSearchTimerRef.current);
      }
      detailAbortRef.current?.abort();
    };
  }, []);

  async function loadList(opts: {
    filters?: ColumnFilters;
    phoneQ?: string;
    page?: number;
    replace?: boolean;
    soft?: boolean;
  } = {}) {
    const replace = opts.replace ?? true;
    const nextFilters = opts.filters ?? filtersRef.current;
    const nextPhoneQ =
      opts.phoneQ !== undefined ? opts.phoneQ : phoneQRef.current;
    const nextPage = opts.page ?? (replace ? 1 : page);
    const seq = ++refreshSeq.current;

    if (replace) {
      if (!opts.soft) setLoading(true);
      loadingMoreRef.current = false;
      setLoadingMore(false);
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    setListError(null);

    const result = await fetchRegsList({
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
        setPage(1);
      }
      setListError(result.message);
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      return;
    }

    setTotal(result.data.total);
    setPage(result.data.page);
    setItems((prev) =>
      replace ? result.data.items : [...prev, ...result.data.items],
    );
    setLoading(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }

  const onLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMoreRef.current) return;
    void loadList({ page: page + 1, replace: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadList closes over latest filters
  }, [hasMore, loading, page, filters, phoneQ]);

  const sentinelRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !listError,
    onLoadMore,
    root: scrollRoot,
  });

  function applyFilters(
    next: ColumnFilters,
    opts: { closeDropdown?: boolean } = {},
  ) {
    setFilters(next);
    if (opts.closeDropdown) setOpenColumn(null);
    void loadList({ filters: next, page: 1, replace: true });
  }

  function onColumnFilterChange(column: string, values: string[]) {
    // Keep the open header menu while editing filters.
    applyFilters(setColumnFilterValues(filtersRef.current, column, values));
  }

  function onRemoveFacet(field: string, value: string) {
    applyFilters(removeFacetValue(filtersRef.current, field, value), {
      closeDropdown: true,
    });
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
    }
    setPhoneInput("");
    setPhoneQ("");
    void loadList({ phoneQ: "", page: 1, replace: true });
  }

  function onResetFilters() {
    if (phoneSearchTimerRef.current != null) {
      window.clearTimeout(phoneSearchTimerRef.current);
    }
    setPhoneInput("");
    setPhoneQ("");
    setFilters({});
    setOpenColumn(null);
    void loadList({ filters: {}, phoneQ: "", page: 1, replace: true });
  }

  async function onManualPoll() {
    if (!canPoll || pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    setPollState((s) => reducePollUiState(s, { type: "START" }));

    try {
      let beforeFinishedAt: string | null = null;
      const beforeStatus = await fetchRegsStatus();
      if (beforeStatus.ok) {
        beforeFinishedAt = beforeStatus.data.lastFinishedAt;
      }

      const result = await postRegsPoll();
      if (!result.ok) {
        setPollState(
          reducePollUiState(IDLE_POLL_STATE, {
            type: "ERROR",
            message: result.message,
            conflict: result.conflict,
          }),
        );
        toast.error(result.message);
        return;
      }

      const outcome = await waitForRegsPollOutcome({
        beforeFinishedAt,
        fetchStatus: async () => {
          const status = await fetchRegsStatus();
          if (!status.ok) {
            throw new Error(status.message);
          }
          return toPollStatusSnapshot(status.data);
        },
      });

      if (outcome.ok) {
        setPollState(
          reducePollUiState(IDLE_POLL_STATE, {
            type: "SUCCESS",
            message: outcome.message,
          }),
        );
        toast.success(outcome.message);
        await loadList({ page: 1, replace: true, soft: true });
      } else {
        setPollState(
          reducePollUiState(IDLE_POLL_STATE, {
            type: "ERROR",
            message: outcome.message,
          }),
        );
        toast.error(outcome.message);
      }
    } catch {
      const message = "Не удалось выполнить опрос";
      setPollState(
        reducePollUiState(IDLE_POLL_STATE, { type: "ERROR", message }),
      );
      toast.error(message);
    } finally {
      pollInFlightRef.current = false;
    }
  }

  async function onRowClick(row: RegistrationListItem) {
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;

    setSelectedPhone(row.phone);
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);

    try {
      const result = await fetchRegsDetail(row.phone, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setDetailError(result.message);
        setDetailLoading(false);
        return;
      }
      setDetail(result.data);
      setDetailLoading(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setDetailError("Не удалось загрузить детали регистрации");
      setDetailLoading(false);
    }
  }

  function onDetailOpenChange(open: boolean) {
    if (!open) {
      detailAbortRef.current?.abort();
      setSelectedPhone(null);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
    }
    setDetailOpen(open);
  }

  const emptyMessage = filtersActive
    ? "Нет регистраций по текущим фильтрам."
    : "Регистраций пока нет. Запустите ручной опрос, когда SSH и check_regs.sh будут готовы.";

  const pollBusy = isPollInFlight(pollState);

  async function onExportXlsx() {
    if (exporting) return;
    setExporting(true);
    const result = await downloadRegsExport();
    setExporting(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Файл экспорта скачан");
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Регистрации</h1>
          <p className="text-sm text-muted-foreground">
            Текущее состояние SIP-регистраций из локальной базы после успешных
            опросов.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            className="border-transparent bg-amber-400 text-amber-950 hover:bg-amber-500 hover:text-amber-950 focus-visible:border-amber-500 focus-visible:ring-amber-400/40"
            onClick={() => void onExportXlsx()}
            disabled={exporting}
          >
            {exporting ? "Экспорт…" : "Экспорт XLSX"}
          </Button>
          {canPoll ? (
            <Button type="button" onClick={onManualPoll} disabled={pollBusy}>
              {pollBusy ? "Загрузка…" : "Загрузить данные"}
            </Button>
          ) : null}
        </div>
      </div>

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

      {pollState.status === "success" ||
      pollState.status === "error" ||
      pollState.status === "conflict" ? (
        <div
          role="status"
          className={
            pollState.status === "success"
              ? "shrink-0 rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200"
              : "shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
        >
          {pollState.message}
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Input
          id="regs-phone-search"
          value={phoneInput}
          onChange={(e) => onPhoneInputChange(e.target.value)}
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
        headers={REG_COLUMN_HEADERS}
        formatValue={displayFacetForColumn}
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
          <RegsTable
            data={items}
            loading={loading && items.length === 0}
            emptyMessage={emptyMessage}
            selectedPhone={selectedPhone}
            filters={filters}
            phoneQ={phoneQ}
            openColumn={openColumn}
            onOpenColumnChange={setOpenColumn}
            onColumnFilterChange={onColumnFilterChange}
            onRowClick={onRowClick}
          />
        </TableInfiniteBody>
        <TableCountFooter shown={items.length} total={total} />
      </div>

      <RegsDetailSheet
        phone={selectedPhone}
        open={detailOpen}
        onOpenChange={onDetailOpenChange}
        loading={detailLoading}
        error={detailError}
        detail={detail}
      />
    </div>
  );
}
