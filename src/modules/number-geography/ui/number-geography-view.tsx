"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadXlsxFromUrl } from "@/lib/download-xlsx";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { PhoneSearchInput } from "@/components/phone-search-input";
import { RowColorMark } from "@/components/row-color-legend";
import { EXPORT_XLSX_BUTTON_CLASS } from "@/components/export-xlsx-button-class";
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
import { formatBlockedOnlyLabel } from "@/lib/format-count";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import {
  fetchNumberGeographyList,
  fetchNumberGeographyPstnFill,
} from "@/modules/number-geography/api-client";
import { NUMBER_GEOGRAPHY_HEADERS } from "@/modules/number-geography/columns";
import {
  geographyAppendAllowed,
  refreshIntervalMs,
} from "@/modules/number-geography/paging";
import { PSTN_FILL_MAX_IDS } from "@/modules/number-geography/pstn-fill-contract";
import {
  blankPstnRowIds,
  mergePstnLabels,
} from "@/modules/number-geography/pstn-fill-rows";
import type {
  ListNumberGeographyResult,
  NumberGeographyItem,
  NumberGeographyRefresh,
} from "@/modules/number-geography/types";
import {
  ActivationDialog,
  type ActivationOutcome,
  type ActivationTarget,
} from "@/modules/number-geography/ui/activation-dialog";
import { NumberGeographyTable } from "@/modules/number-geography/ui/number-geography-table";

const PAGE_SIZE = TABLE_PAGE_SIZE;
const PHONE_SEARCH_DEBOUNCE_MS = 300;

type Props = {
  initial: ListNumberGeographyResult;
  canRequest: boolean;
  canActivate: boolean;
};

export function NumberGeographyView({ initial, canRequest, canActivate }: Props) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [blockedCount, setBlockedCount] = useState(initial.blockedCount);
  const [openColumn, setOpenColumn] = useState<string | null>(null);
  const [page, setPage] = useState(initial.page);
  const [items, setItems] = useState(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activationTarget, setActivationTarget] = useState<ActivationTarget | null>(null);
  const [activationPending, setActivationPending] = useState(false);
  const [activationResult, setActivationResult] = useState<ActivationOutcome | null>(
    null,
  );
  const dialogOpenRef = useRef(false);
  const [lookupFailed, setLookupFailed] = useState<ReadonlySet<string>>(() => new Set());
  const supplierFileRef = useRef<HTMLInputElement>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  const refreshSeq = useRef(0);
  const inFlightRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const filtersRef = useRef(filters);
  const phoneQRef = useRef(phoneQ);
  const blockedOnlyRef = useRef(blockedOnly);
  const phoneSearchTimerRef = useRef<number | null>(null);
  const pageRef = useRef(page);
  const itemsLenRef = useRef(items.length);
  const openColumnRef = useRef(openColumn);
  const refreshRef = useRef<NumberGeographyRefresh>(initial.refresh);
  const catalogStampRef = useRef(initial.catalogStamp ?? "");
  const armRef = useRef<() => void>(() => {});
  const loadListRef = useRef<
    (opts: {
      filters?: ColumnFilters;
      phoneQ?: string;
      blockedOnly?: boolean;
      page?: number;
      replace?: boolean;
      soft?: boolean;
    }) => Promise<void>
  >(async () => {});
  const fillGeneration = useRef(0);
  const fillQueue = useRef<string[]>([]);
  const fillQueued = useRef(new Set<string>());
  const fillInvalid = useRef(new Set<string>());
  const fillDraining = useRef(false);
  const enqueueFillRef = useRef<
    (rows: NumberGeographyItem[], mode: "append" | "replace" | "soft") => void
  >(() => {});

  const hasMore = items.length < total;
  const filtersActive =
    hasActiveFilters(filters) || phoneQ.trim().length > 0 || blockedOnly;

  async function loadList(opts: {
    filters?: ColumnFilters;
    phoneQ?: string;
    blockedOnly?: boolean;
    page?: number;
    replace?: boolean;
    soft?: boolean;
  }) {
    const replace = opts.replace ?? true;
    const soft = opts.soft === true;
    const nextFilters = opts.filters ?? filtersRef.current;
    const nextPhoneQ = opts.phoneQ !== undefined ? opts.phoneQ : phoneQRef.current;
    const nextBlocked =
      opts.blockedOnly !== undefined ? opts.blockedOnly : blockedOnlyRef.current;
    const nextPage = opts.page ?? (replace ? 1 : pageRef.current);
    const seq = ++refreshSeq.current;
    inFlightRef.current = true;

    if (replace) {
      if (!soft) setLoading(true);
      loadingMoreRef.current = false;
      setLoadingMore(false);
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    if (!soft) setListError(null);

    try {
      const result = await fetchNumberGeographyList({
        filters: nextFilters,
        phoneQ: nextPhoneQ,
        blockedOnly: nextBlocked,
        page: nextPage,
        pageSize: PAGE_SIZE,
      });
      if (seq !== refreshSeq.current) return;

      if (!result.ok) {
        if (replace && !soft) {
          setItems([]);
          setTotal(0);
          setPage(1);
        }
        setListError(result.message);
        return;
      }

      const nextStamp = result.data.catalogStamp ?? "";
      if (!replace && !geographyAppendAllowed(catalogStampRef.current, nextStamp)) {
        await loadList({
          filters: nextFilters,
          phoneQ: nextPhoneQ,
          blockedOnly: nextBlocked,
          page: 1,
          replace: true,
          soft,
        });
        return;
      }
      catalogStampRef.current = nextStamp;

      const prevRefresh = refreshRef.current;
      const nextRefresh = result.data.refresh;
      refreshRef.current = nextRefresh;
      setTotal(result.data.total);
      setBlockedCount(result.data.blockedCount);
      setPage(result.data.page);
      setItems((prev) => (replace ? result.data.items : [...prev, ...result.data.items]));
      setListError(null);
      if (
        prevRefresh.enabled !== nextRefresh.enabled ||
        prevRefresh.intervalSec !== nextRefresh.intervalSec
      ) {
        armRef.current();
      }
      enqueueFillRef.current(
        result.data.items,
        replace ? (soft ? "soft" : "replace") : "append",
      );
    } finally {
      if (seq === refreshSeq.current) {
        inFlightRef.current = false;
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }

  function rememberLookupFailed(ids: readonly string[]) {
    if (ids.length === 0) return;
    setLookupFailed((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (next.has(id)) continue;
        next.add(id);
        changed = true;
      }
      return changed ? next : prev;
    });
  }

  function forgetLookupFailed(ids: readonly string[]) {
    if (ids.length === 0) return;
    setLookupFailed((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (!next.delete(id)) continue;
        changed = true;
      }
      return changed ? next : prev;
    });
  }

  function enqueueFill(rows: NumberGeographyItem[], mode: "append" | "replace" | "soft") {
    if (mode !== "append") {
      fillGeneration.current += 1;
      fillQueue.current = [];
      fillQueued.current = new Set();
      if (mode === "replace") fillInvalid.current = new Set();
    }
    const generation = fillGeneration.current;
    const queuedNow: string[] = [];
    for (const id of blankPstnRowIds(rows, fillInvalid.current)) {
      if (fillQueued.current.has(id)) continue;
      fillQueued.current.add(id);
      fillQueue.current.push(id);
      queuedNow.push(id);
    }
    forgetLookupFailed(queuedNow);
    void drainFill(generation);
  }

  async function drainFill(generation: number) {
    if (fillDraining.current) return;
    if (generation !== fillGeneration.current) return;
    fillDraining.current = true;
    try {
      while (fillQueue.current.length > 0 && generation === fillGeneration.current) {
        const chunk = fillQueue.current.splice(0, PSTN_FILL_MAX_IDS);
        const result = await fetchNumberGeographyPstnFill(chunk);
        if (generation !== fillGeneration.current) return;
        for (const id of chunk) fillQueued.current.delete(id);
        if (!result.ok) {
          rememberLookupFailed(chunk);
          for (const id of fillQueue.current) fillQueued.current.delete(id);
          fillQueue.current = [];
          return;
        }
        if (!result.data.configured) {
          const failedIds = [...chunk, ...fillQueue.current];
          fillQueue.current = [];
          fillQueued.current = new Set();
          rememberLookupFailed(failedIds);
          return;
        }
        const updates: { id: string; operator: string; geography: string }[] = [];
        for (const item of result.data.items) {
          if (item.status === "invalid") fillInvalid.current.add(item.id);
          if (item.status === "error") rememberLookupFailed([item.id]);
          if (
            (item.status === "filled" || item.status === "cached") &&
            item.operator != null &&
            item.geography != null
          ) {
            updates.push({
              id: item.id,
              operator: item.operator,
              geography: item.geography,
            });
          }
        }
        if (generation === fillGeneration.current) {
          setItems((prev) => mergePstnLabels(prev, updates));
        }
      }
    } finally {
      fillDraining.current = false;
      if (fillQueue.current.length > 0) {
        void drainFill(fillGeneration.current);
      }
    }
  }

  useEffect(() => {
    filtersRef.current = filters;
    phoneQRef.current = phoneQ;
    blockedOnlyRef.current = blockedOnly;
    pageRef.current = page;
    itemsLenRef.current = items.length;
    openColumnRef.current = openColumn;
    loadListRef.current = loadList;
    enqueueFillRef.current = enqueueFill;
  });

  useEffect(() => {
    enqueueFillRef.current(initial.items, "replace");
    // The server payload is the first page. Later pages enqueue from loadList.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    let cancelled = false;

    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const tick = () => {
      if (document.visibilityState === "hidden") return;
      if (!refreshRef.current.enabled) return;
      if (inFlightRef.current) return;
      if (dialogOpenRef.current) return;
      if (openColumnRef.current) return;
      if (pageRef.current > 1 || itemsLenRef.current > PAGE_SIZE) return;
      void loadListRef.current({ page: 1, replace: true, soft: true });
    };

    const arm = () => {
      stop();
      if (cancelled) return;
      const refresh = refreshRef.current;
      if (!refresh.enabled) return;
      if (document.visibilityState === "hidden") return;
      timer = window.setInterval(tick, refreshIntervalMs(refresh.intervalSec));
    };
    armRef.current = arm;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      tick();
      arm();
    };

    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

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
    setBlockedOnly(false);
    setFilters({});
    setOpenColumn(null);
    void loadList({
      filters: {},
      phoneQ: "",
      blockedOnly: false,
      page: 1,
      replace: true,
    });
  }

  function onBlockedOnlyChange(checked: boolean) {
    setBlockedOnly(checked);
    void loadList({ blockedOnly: checked, page: 1, replace: true });
  }

  async function onExport() {
    if (exporting || uploading) return;
    setExporting(true);
    setActionError(null);
    setActionMessage(null);
    const result = await downloadXlsxFromUrl(
      "/api/number-geography/export",
      "number-geography.xlsx",
    );
    setExporting(false);
    if (!result.ok) setActionError(result.message);
  }

  async function onSupplierFile(file: File | undefined) {
    if (!file || uploading || exporting) return;
    setUploading(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/phones/suppliers", {
        method: "POST",
        body,
      });
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
        details?: string[];
        updated?: number;
        cleared?: number;
        categoryUpdated?: number;
        categoryCleared?: number;
        unmatched?: number;
      } | null;
      if (!res.ok) {
        const details = payload?.details?.filter(Boolean).join("; ");
        setActionError(
          [payload?.error, details].filter(Boolean).join(": ") ||
            "Не удалось загрузить поставщиков",
        );
        return;
      }
      setActionMessage(
        `Поставщики: обновлено ${payload?.updated ?? 0}, очищено ${payload?.cleared ?? 0}, не найдено ${payload?.unmatched ?? 0}. Категории: обновлено ${payload?.categoryUpdated ?? 0}, очищено ${payload?.categoryCleared ?? 0}`,
      );
      await loadList({ filters, page: 1, replace: true });
    } catch {
      setActionError("Не удалось загрузить поставщиков");
    } finally {
      setUploading(false);
      if (supplierFileRef.current) supplierFileRef.current.value = "";
    }
  }

  function openActivation(row: NumberGeographyItem) {
    if (!canActivate || activationPending || activationResult) return;
    dialogOpenRef.current = true;
    setActionError(null);
    setActionMessage(null);
    setActivationResult(null);
    setActivationTarget({
      id: row.id,
      number: row.number,
      title: row.title,
      activation: row.activation,
    });
  }

  function closeActivation() {
    if (activationPending) return;
    dialogOpenRef.current = false;
    setActivationTarget(null);
    setActivationResult(null);
  }

  async function confirmActivation(phone: string) {
    const target = activationTarget;
    if (!target || activationPending || activationResult) return;
    setActivationPending(true);
    dialogOpenRef.current = true;
    const network =
      "Ответ не получен. Не нажимайте ссылку снова, пока строка не обновится или не появится сообщение сервера.";
    let outcome: ActivationOutcome = { ok: false, message: network };
    let responded = false;
    try {
      const res = await fetch("/api/number-geography/activation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpointId: target.id,
          phone,
          activation: target.activation,
          title: target.title,
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
      } | null;
      outcome = {
        ok: res.ok && payload?.ok === true,
        message: payload?.message || payload?.error || network,
      };
      responded = res.ok;
    } catch {
      outcome = { ok: false, message: network };
    } finally {
      setActivationPending(false);
      setActivationResult(outcome);
      if (outcome.ok) {
        setActionMessage(outcome.message);
        setActionError(null);
      } else {
        setActionError(outcome.message);
        setActionMessage(null);
      }
    }
    if (responded) await loadList({ page: 1, replace: true });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <ActivationDialog
        target={activationTarget}
        pending={activationPending}
        result={activationResult}
        onClose={closeActivation}
        onConfirm={(phone) => void confirmActivation(phone)}
      />
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
            География номеров
          </h1>
          <p className="text-muted-foreground text-sm">
            Оконечные номера каталога. Город из тарификации. Оператор и территория из кэша
            PSTN.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canRequest ? (
            <>
              <input
                ref={supplierFileRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) => void onSupplierFile(event.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                disabled={uploading || exporting}
                onClick={() => supplierFileRef.current?.click()}
              >
                {uploading ? "Загрузка…" : "Загрузить поставщиков"}
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            className={EXPORT_XLSX_BUTTON_CLASS}
            disabled={exporting || uploading}
            onClick={() => void onExport()}
          >
            {exporting ? "Экспорт…" : "Экспорт XLSX"}
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <PhoneSearchInput
          id="number-geography-phone-search"
          value={phoneInput}
          onChange={onPhoneInputChange}
        />
        <div className="flex items-center gap-2">
          <input
            id="number-geography-blocked-only"
            type="checkbox"
            className="size-4 rounded border"
            checked={blockedOnly}
            onChange={(e) => onBlockedOnlyChange(e.target.checked)}
          />
          <Label htmlFor="number-geography-blocked-only">
            <RowColorMark tone="blocked">
              {formatBlockedOnlyLabel(blockedCount)}
            </RowColorMark>
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

      {actionError ? (
        <p className="text-destructive shrink-0 text-sm">{actionError}</p>
      ) : null}
      {actionMessage ? (
        <p className="text-muted-foreground shrink-0 text-sm">{actionMessage}</p>
      ) : null}

      <ActiveFiltersBar
        filters={filters}
        headers={NUMBER_GEOGRAPHY_HEADERS}
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
          <NumberGeographyTable
            data={items}
            loading={loading && items.length === 0}
            emptyMessage={
              filtersActive
                ? "Нет данных по текущим фильтрам. Сбросьте фильтры или уточните выбор."
                : "Нет данных."
            }
            filters={filters}
            phoneQ={phoneQ}
            blockedOnly={blockedOnly}
            lookupFailed={lookupFailed}
            openColumn={openColumn}
            onOpenColumnChange={setOpenColumn}
            onColumnFilterChange={onColumnChange}
            onActivation={canActivate ? openActivation : undefined}
          />
        </TableInfiniteBody>
        <TableCountFooter shown={items.length} total={total} />
      </div>
    </div>
  );
}
