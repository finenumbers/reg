"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ActiveFiltersBar,
  ColumnFilterDropdown,
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
  buildPhonesFacetsUrl,
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

const PAGE_SIZE = TABLE_PAGE_SIZE;

type Props = {
  canRequest: boolean;
  initial: ListPhonesResult;
};

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "ещё не загружалось";
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

function selectKind(next: PhoneKind, current: PhoneKind, load: (k: PhoneKind) => void) {
  if (next === current) return;
  load(next);
}

export function PhonesView({ canRequest, initial }: Props) {
  const [kind, setKind] = useState<PhoneKind>(initial.kind);
  const [filters, setFilters] = useState<ColumnFilters>({});
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
  const syncInFlightRef = useRef(false);
  const refreshSeq = useRef(0);
  const loadingMoreRef = useRef(false);
  const filtersRef = useRef(filters);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  filtersRef.current = filters;

  const hasMore = items.length < total;
  const filtersActive = hasActiveFilters(filters);

  const headerLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const h of headers) map[h] = h;
    return map;
  }, [headers]);

  const buildFacetsUrl = useCallback(
    (opts: { column: string; filters: ColumnFilters; q: string }) =>
      buildPhonesFacetsUrl({
        kind,
        column: opts.column,
        filters: opts.filters,
        q: opts.q,
      }),
    [kind],
  );

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
    page?: number;
    replace?: boolean;
  }) {
    const replace = opts.replace ?? true;
    const nextKind = opts.kind ?? kind;
    const nextFilters = opts.filters ?? filtersRef.current;
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
  }, [hasMore, loading, page, kind, filters]);

  const sentinelRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !listError,
    onLoadMore,
    root: scrollRoot,
  });

  function applyFilters(next: ColumnFilters) {
    setFilters(next);
    setOpenColumn(null);
    void loadList({ filters: next, page: 1, replace: true });
  }

  function onColumnChange(field: string, values: string[]) {
    applyFilters(setColumnFilterValues(filtersRef.current, field, values));
  }

  function onRemoveFacet(field: string, value: string) {
    applyFilters(removeFacetValue(filtersRef.current, field, value));
  }

  function onResetFilters() {
    applyFilters({});
  }

  async function onRequest() {
    if (!canRequest || syncInFlightRef.current || isSyncInFlight(syncState)) {
      return;
    }
    syncInFlightRef.current = true;
    setSyncState(reduceSyncUiState(syncState, { type: "START" }));

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
      syncInFlightRef.current = false;
      return;
    }

    const outcome = await waitForPhonesSyncOutcome({
      beforeFinishedAt,
      fetchStatus: async () => {
        const status = await fetchPhonesStatus();
        if (!status.ok) {
          return {
            lastJobStatus: null,
            lastError: status.message,
            lastFinishedAt: beforeFinishedAt,
            runningCount: 0,
          };
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
    syncInFlightRef.current = false;
  }

  const pending = isSyncInFlight(syncState);

  function switchKind(next: PhoneKind) {
    selectKind(next, kind, (k) => {
      setKind(k);
      setFilters({});
      setOpenColumn(null);
      void loadList({ kind: k, filters: {}, page: 1, replace: true });
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
            Последняя синхронизация: {formatSyncedAt(lastSyncedAt)}. Шлюзы:{" "}
            {gatewayCount}
            , с рег.: {registeredCount}, без рег.: {unregisteredCount}
            {errorCount > 0 ? `, ошибка: ${errorCount}` : ""}
            {endpointCount > 0 ? ` (всего EP: ${endpointCount})` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!filtersActive}
            onClick={onResetFilters}
          >
            Сбросить фильтры
          </Button>
          {canRequest ? (
            <Button
              type="button"
              onClick={() => void onRequest()}
              disabled={pending}
            >
              {pending ? "Загрузка…" : "Загрузить данные"}
            </Button>
          ) : null}
        </div>
      </div>

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

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={kind === "gateways" ? "default" : "outline"}
          size="sm"
          onClick={() => switchKind("gateways")}
        >
          Шлюзы
        </Button>
        <Button
          type="button"
          variant={kind === "endpoints_registered" ? "default" : "outline"}
          size="sm"
          onClick={() => switchKind("endpoints_registered")}
        >
          Оборудование с регистрацией
        </Button>
        <Button
          type="button"
          variant={kind === "endpoints_unregistered" ? "default" : "outline"}
          size="sm"
          onClick={() => switchKind("endpoints_unregistered")}
        >
          Оборудование без регистрации
        </Button>
        {errorCount > 0 ? (
          <Button
            type="button"
            variant={kind === "endpoints_error" ? "default" : "outline"}
            size="sm"
            className={
              kind !== "endpoints_error"
                ? "border-destructive/50 text-destructive"
                : undefined
            }
            onClick={() => switchKind("endpoints_error")}
          >
            Ошибка ({errorCount})
          </Button>
        ) : null}
      </div>

      <ActiveFiltersBar
        filters={filters}
        headers={headerLabels}
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
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm">
              <tr>
                {headers.map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap border-b px-3 py-1 font-medium"
                  >
                    <ColumnFilterDropdown
                      column={h}
                      header={h}
                      open={openColumn === h}
                      selected={filters[h] ?? []}
                      filters={filters}
                      buildFacetsUrl={buildFacetsUrl}
                      onToggle={() =>
                        setOpenColumn((c) => (c === h ? null : h))
                      }
                      onChange={(values) => onColumnChange(h, values)}
                      onClear={() => onColumnChange(h, [])}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-2 text-sm text-muted-foreground"
                    colSpan={Math.max(headers.length, 1)}
                  >
                    Загрузка…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-2 text-sm text-muted-foreground"
                    colSpan={Math.max(headers.length, 1)}
                  >
                    {filtersActive
                      ? "Нет данных по текущим фильтрам. Сбросьте фильтры или уточните выбор."
                      : "Нет данных. Нажмите «Загрузить данные», чтобы загрузить с softswitch."}
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="odd:bg-muted/20">
                    {headers.map((h) => (
                      <td
                        key={`${row.id}-${h}`}
                        className="max-w-[18rem] truncate whitespace-nowrap border-b px-3 py-1 align-top text-sm"
                        title={row.data[h] ?? ""}
                      >
                        {row.data[h] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableInfiniteBody>
        <TableCountFooter shown={items.length} total={total} />
      </div>
    </div>
  );
}
