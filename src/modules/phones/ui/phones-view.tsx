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
import { formatCount } from "@/lib/format-count";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import {
  convertPhonesRtuImport,
  downloadPhonesExport,
  downloadPhonesUfwExport,
  fetchPhonesList,
  fetchPhonesStatus,
  postPhonesRequest,
  toSyncStatusSnapshot,
} from "@/modules/phones/api-client";
import {
  IDLE_SYNC_STATE,
  isSyncInFlight,
  reduceSyncUiState,
  waitForPhonesSyncOutcome,
  type SyncUiState,
} from "@/modules/phones/request-action";
import type { ListPhonesResult } from "@/modules/phones/service";
import type { PhoneKind } from "@/modules/phones/types";
import { PhonesTable } from "@/modules/phones/ui/phones-table";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { formatDisplayTimestamp } from "@/lib/format-display-time";

const PAGE_SIZE = TABLE_PAGE_SIZE;
const PHONE_SEARCH_DEBOUNCE_MS = 300;

type Props = {
  canRequest: boolean;
  initial: ListPhonesResult;
};

function formatSyncedAt(iso: string | null, timeZone: string): string {
  if (!iso) return "ещё не загружалось";
  return formatDisplayTimestamp(iso, timeZone);
}

function selectKind(next: PhoneKind, current: PhoneKind, load: (k: PhoneKind) => void) {
  if (next === current) return;
  load(next);
}

export function PhonesView({ canRequest, initial }: Props) {
  const { timeZone } = useDisplayTimezone();
  const [kind, setKind] = useState<PhoneKind>(initial.kind);
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const [sipUnregisteredOnly, setSipUnregisteredOnly] = useState(false);
  const [openColumn, setOpenColumn] = useState<string | null>(null);
  const [page, setPage] = useState(initial.page);
  const [items, setItems] = useState(initial.items);
  const [headers, setHeaders] = useState(initial.headers);
  const [total, setTotal] = useState(initial.total);
  const [endpointCount, setEndpointCount] = useState(initial.endpointCount);
  const [gatewayCount, setGatewayCount] = useState(initial.gatewayCount);
  const [registeredCount, setRegisteredCount] = useState(
    initial.registeredCount,
  );
  const [unregisteredCount, setUnregisteredCount] = useState(
    initial.unregisteredCount,
  );
  const [errorCount, setErrorCount] = useState(initial.errorCount);
  const [lastSyncedAt, setLastSyncedAt] = useState(initial.lastSyncedAt);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncUiState>(IDLE_SYNC_STATE);
  const [exporting, setExporting] = useState(false);
  const [rtuConverting, setRtuConverting] = useState(false);
  const [ufwExporting, setUfwExporting] = useState(false);
  const [rtuError, setRtuError] = useState<{
    error: string;
    details: string[];
  } | null>(null);
  const rtuFileInputRef = useRef<HTMLInputElement | null>(null);
  const syncInFlightRef = useRef(false);
  const refreshSeq = useRef(0);
  const loadingMoreRef = useRef(false);
  const filtersRef = useRef(filters);
  const phoneQRef = useRef(phoneQ);
  const sipUnregisteredOnlyRef = useRef(sipUnregisteredOnly);
  const phoneSearchTimerRef = useRef<number | null>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  filtersRef.current = filters;
  phoneQRef.current = phoneQ;
  sipUnregisteredOnlyRef.current = sipUnregisteredOnly;

  const hasMore = items.length < total;
  const filtersActive =
    hasActiveFilters(filters) ||
    phoneQ.trim().length > 0 ||
    sipUnregisteredOnly;

  const headerLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const h of headers) map[h] = h;
    return map;
  }, [headers]);

  const longestKindLabel = useMemo(() => {
    const labels = [
      "Шлюзы",
      "Транки с регистрацией",
      "Транки без регистрации",
      ...(errorCount > 0 || kind === "endpoints_error"
        ? [`Ошибка (${formatCount(errorCount)})`]
        : []),
    ];
    return labels.reduce((a, b) => (b.length > a.length ? b : a));
  }, [errorCount, kind]);

  useEffect(() => {
    return () => {
      if (phoneSearchTimerRef.current != null) {
        window.clearTimeout(phoneSearchTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (kind === "endpoints_error" && errorCount === 0) {
      setKind("endpoints_registered");
      void loadList({ kind: "endpoints_registered", page: 1, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- leave empty error tab after sync
  }, [kind, errorCount]);

  async function loadList(opts: {
    kind?: PhoneKind;
    filters?: ColumnFilters;
    phoneQ?: string;
    sipUnregisteredOnly?: boolean;
    page?: number;
    replace?: boolean;
  }) {
    const replace = opts.replace ?? true;
    const nextKind = opts.kind ?? kind;
    const nextFilters = opts.filters ?? filtersRef.current;
    const nextPhoneQ =
      opts.phoneQ !== undefined ? opts.phoneQ : phoneQRef.current;
    const nextSipOnly =
      opts.sipUnregisteredOnly !== undefined
        ? opts.sipUnregisteredOnly
        : sipUnregisteredOnlyRef.current;
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

    const result = await fetchPhonesList({
      kind: nextKind,
      filters: nextFilters,
      phoneQ: nextPhoneQ,
      sipUnregisteredOnly:
        nextKind === "endpoints_registered" ? nextSipOnly : false,
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

    setKind(result.data.kind);
    setHeaders(result.data.headers);
    setTotal(result.data.total);
    setPage(result.data.page);
    setEndpointCount(result.data.endpointCount);
    setGatewayCount(result.data.gatewayCount);
    setRegisteredCount(result.data.registeredCount);
    setUnregisteredCount(result.data.unregisteredCount);
    setErrorCount(result.data.errorCount);
    setLastSyncedAt(result.data.lastSyncedAt);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, page, kind, filters, phoneQ, sipUnregisteredOnly]);

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

  function onColumnChange(field: string, values: string[]) {
    applyFilters(setColumnFilterValues(filtersRef.current, field, values));
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
    setSipUnregisteredOnly(false);
    setFilters({});
    setOpenColumn(null);
    void loadList({
      filters: {},
      phoneQ: "",
      sipUnregisteredOnly: false,
      page: 1,
      replace: true,
    });
  }

  function onSipUnregisteredOnlyChange(checked: boolean) {
    setSipUnregisteredOnly(checked);
    void loadList({
      sipUnregisteredOnly: checked,
      page: 1,
      replace: true,
    });
  }

  async function onRequest() {
    if (!canRequest || syncInFlightRef.current || isSyncInFlight(syncState)) {
      return;
    }
    syncInFlightRef.current = true;
    setSyncState(reduceSyncUiState(syncState, { type: "START" }));

    try {
      const before = await fetchPhonesStatus();
      const beforeFinishedAt = before.ok ? before.data.lastFinishedAt : null;

      const enqueued = await postPhonesRequest();
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
          const status = await fetchPhonesStatus();
          if (!status.ok) {
            throw new Error(status.message);
          }
          return toSyncStatusSnapshot(status.data);
        },
      });

      if (outcome.ok) {
        setSyncState(
          reduceSyncUiState(IDLE_SYNC_STATE, {
            type: "SUCCESS",
            message: outcome.message,
          }),
        );
        toast.success(outcome.message);
        await loadList({ page: 1, replace: true });
      } else {
        setSyncState(
          reduceSyncUiState(IDLE_SYNC_STATE, {
            type: "ERROR",
            message: outcome.message,
          }),
        );
        toast.error(outcome.message);
      }
    } catch {
      const message = "Не удалось выполнить запрос";
      setSyncState(
        reduceSyncUiState(IDLE_SYNC_STATE, { type: "ERROR", message }),
      );
      toast.error(message);
    } finally {
      syncInFlightRef.current = false;
    }
  }

  async function onExportXlsx() {
    if (exporting) return;
    setExporting(true);
    const result = await downloadPhonesExport();
    setExporting(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Файл экспорта скачан");
  }

  function onRtuImportClick() {
    if (rtuConverting) return;
    setRtuError(null);
    rtuFileInputRef.current?.click();
  }

  async function onRtuFileSelected(fileList: FileList | null) {
    const file = fileList?.[0];
    if (rtuFileInputRef.current) rtuFileInputRef.current.value = "";
    if (!file || rtuConverting) return;

    setRtuConverting(true);
    setRtuError(null);
    const result = await convertPhonesRtuImport(file);
    setRtuConverting(false);

    if (!result.ok) {
      setRtuError({ error: result.error, details: result.details });
      toast.error(result.error);
      return;
    }
    toast.success("CSV для импорта в РТУ скачан");
  }

  async function onUfwExport() {
    if (ufwExporting) return;
    setUfwExporting(true);
    const result = await downloadPhonesUfwExport();
    setUfwExporting(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Файл для импорта в UFW скачан");
  }

  const pending = isSyncInFlight(syncState);

  function switchKind(next: PhoneKind) {
    selectKind(next, kind, (k) => {
      setKind(k);
      setFilters({});
      setPhoneInput("");
      setPhoneQ("");
      setSipUnregisteredOnly(false);
      setOpenColumn(null);
      void loadList({
        kind: k,
        filters: {},
        phoneQ: "",
        sipUnregisteredOnly: false,
        page: 1,
        replace: true,
      });
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Телефонные номера
          </h1>
          <p className="text-sm text-muted-foreground">
            Последняя синхронизация: {formatSyncedAt(lastSyncedAt, timeZone)}. Шлюзы:{" "}
            {formatCount(gatewayCount)}
            , с рег.: {formatCount(registeredCount)}, без рег.:{" "}
            {formatCount(unregisteredCount)}
            {errorCount > 0 ? `, ошибка: ${formatCount(errorCount)}` : ""}
            {endpointCount > 0
              ? ` (всего EP: ${formatCount(endpointCount)})`
              : ""}
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            className="border-transparent bg-amber-400 text-amber-950 hover:bg-amber-500 hover:text-amber-950 focus-visible:border-amber-500 focus-visible:ring-amber-400/40"
            onClick={() => void onExportXlsx()}
            disabled={exporting || rtuConverting || ufwExporting}
          >
            {exporting ? "Экспорт…" : "Экспорт XLSX"}
          </Button>
          <input
            ref={rtuFileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => void onRtuFileSelected(e.target.files)}
          />
          <Button
            type="button"
            className="border-transparent bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white focus-visible:border-emerald-700 focus-visible:ring-emerald-600/40"
            onClick={onRtuImportClick}
            disabled={rtuConverting || exporting || ufwExporting}
          >
            {rtuConverting ? "Конвертация…" : "Импорт в РТУ"}
          </Button>
          <Button
            type="button"
            className="border-transparent bg-blue-700 text-white hover:bg-blue-800 hover:text-white focus-visible:border-blue-800 focus-visible:ring-blue-700/40"
            onClick={() => void onUfwExport()}
            disabled={ufwExporting || exporting || rtuConverting}
          >
            {ufwExporting ? "Формирование…" : "Импорт в UFW"}
          </Button>
          {canRequest ? (
            <Button
              type="button"
              onClick={() => void onRequest()}
              disabled={pending || ufwExporting || rtuConverting || exporting}
            >
              {pending ? "Загрузка…" : "Загрузить данные"}
            </Button>
          ) : null}
        </div>
      </div>

      {rtuError ? (
        <div
          role="alert"
          className="flex min-h-0 shrink-0 flex-col rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <p className="shrink-0 font-medium">{rtuError.error}</p>
          <ul className="mt-1 max-h-[min(40vh,20rem)] list-disc space-y-0.5 overflow-y-auto pl-5">
            {rtuError.details.map((d, i) => (
              <li key={`${i}-${d.slice(0, 48)}`}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {syncState.message ? (
        <p
          className={
            syncState.status === "success"
              ? "shrink-0 text-sm text-emerald-700"
              : "shrink-0 text-sm text-destructive"
          }
        >
          {syncState.message}
        </p>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="phones-phone-search"
            value={phoneInput}
            onChange={(e) => onPhoneInputChange(e.target.value)}
            placeholder="Телефонный номер"
            aria-label="Телефонный номер"
            size={19}
            className="w-[calc(17ch+1.25rem)] shrink-0"
            autoComplete="off"
          />
          {kind === "endpoints_registered" ? (
            <div className="flex items-center gap-2">
              <input
                id="phones-sip-unregistered-only"
                type="checkbox"
                className="size-4 rounded border"
                checked={sipUnregisteredOnly}
                onChange={(e) =>
                  onSipUnregisteredOnlyChange(e.target.checked)
                }
              />
              <Label htmlFor="phones-sip-unregistered-only">
                Без регистрации
              </Label>
            </div>
          ) : null}
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
            id="phones-kind"
            value={kind}
            onChange={(e) => switchKind(e.target.value as PhoneKind)}
            aria-label="Раздел"
            className="col-start-1 row-start-1 h-8 w-full rounded-lg border border-border bg-background py-0 pl-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="gateways">Шлюзы</option>
            <option value="endpoints_registered">
              Транки с регистрацией
            </option>
            <option value="endpoints_unregistered">
              Транки без регистрации
            </option>
            {errorCount > 0 || kind === "endpoints_error" ? (
              <option value="endpoints_error">
                Ошибка ({formatCount(errorCount)})
              </option>
            ) : null}
          </select>
          <span
            aria-hidden
            className="invisible col-start-1 row-start-1 h-8 whitespace-nowrap border border-transparent py-0 pl-2.5 pr-8 text-sm"
          >
            {longestKindLabel}
          </span>
        </div>
      </div>

      <ActiveFiltersBar
        filters={filters}
        headers={headerLabels}
        phoneQuery={phoneQ}
        onClearPhoneQuery={onClearPhoneQuery}
        onRemoveFacet={onRemoveFacet}
      />

      {listError ? (
        <p className="shrink-0 text-sm text-destructive">{listError}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableInfiniteBody
          scrollRef={setScrollRoot}
          sentinelRef={sentinelRef}
          loadingMore={loadingMore}
        >
          <PhonesTable
            kind={kind}
            headers={headers}
            data={items}
            loading={loading && items.length === 0}
            emptyMessage={
              filtersActive
                ? "Нет данных по текущим фильтрам. Сбросьте фильтры или уточните выбор."
                : "Нет данных. Нажмите «Загрузить данные», чтобы загрузить с softswitch."
            }
            filters={filters}
            phoneQ={phoneQ}
            sipUnregisteredOnly={
              kind === "endpoints_registered" && sipUnregisteredOnly
            }
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
