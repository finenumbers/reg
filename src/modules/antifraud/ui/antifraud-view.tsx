"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitSelect } from "@/components/fit-select";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { PhoneSearchInput } from "@/components/phone-search-input";
import { Button } from "@/components/ui/button";
import {
  ActiveFiltersBar,
  hasActiveFilters,
  setColumnFilterValues,
  type ColumnFilters,
} from "@/components/column-filters";
import { TableCountFooter, TableInfiniteBody } from "@/components/table-infinite-body";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { fetchAntifraudList, fetchAntifraudStatus } from "@/modules/antifraud/api-client";
import { RADIUS_LABELS } from "@/modules/antifraud/columns";
import type { ListRadiusResult, RadiusListItem } from "@/modules/antifraud/service";
import { AntifraudTable } from "@/modules/antifraud/ui/antifraud-table";
import type { TimeSort } from "@/modules/traffic/traffic-sort";
import { LoadAgeChip } from "@/modules/traffic/ui/load-age-chip";

const PHONE_SEARCH_DEBOUNCE_MS = 300;
const STATUS_POLL_MS = 4000;

type LoadOpts = {
  page?: number;
  replace?: boolean;
  quiet?: boolean;
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  timeSort?: TimeSort | null;
};

const ANTIFRAUD_CLOCK_LABELS = {
  green: "в порции были запросы",
  yellow: "порция без целой записи",
  red: "новых записей не было",
};

function gapLabel(reason: string): string {
  if (reason === "inode_changed") return "файл сменился";
  if (reason === "file_shrunk") return "файл усечён";
  if (reason === "source_changed") return "источник сменился";
  return reason;
}

export function AntifraudView({
  initial,
  initialListError = null,
}: {
  initial: ListRadiusResult;
  initialListError?: string | null;
}) {
  const [items, setItems] = useState<RadiusListItem[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [month, setMonth] = useState(initial.month);
  const [months, setMonths] = useState(initial.months);
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const [timeSort, setTimeSort] = useState<TimeSort | null>("desc");
  const [openColumn, setOpenColumn] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(initialListError);
  const [undatedCount, setUndatedCount] = useState(initial.undatedCount);
  const [gaps, setGaps] = useState(initial.gaps);
  const [configured, setConfigured] = useState(initial.configured);
  const [lastPassAt, setLastPassAt] = useState(initial.lastPassAt);
  const [hadCalls, setHadCalls] = useState(initial.hadCalls);
  const [lastCheckedAt, setLastCheckedAt] = useState(initial.lastCheckedAt);
  const [lastError, setLastError] = useState(initial.lastError);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const pageRef = useRef(initial.page);
  const filtersRef = useRef(filters);
  const phoneQRef = useRef(phoneQ);
  const monthRef = useRef(month);
  const timeSortRef = useRef(timeSort);
  const phoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPassRef = useRef(initial.lastPassAt);

  useEffect(() => {
    filtersRef.current = filters;
    phoneQRef.current = phoneQ;
    monthRef.current = month;
    timeSortRef.current = timeSort;
  }, [filters, phoneQ, month, timeSort]);

  useEffect(() => {
    return () => {
      if (phoneTimerRef.current) clearTimeout(phoneTimerRef.current);
    };
  }, []);

  const loadList = useCallback(async (opts: LoadOpts = {}): Promise<boolean> => {
    const replace = opts.replace ?? true;
    const quiet = opts.quiet === true;
    const nextFilters = opts.filters ?? filtersRef.current;
    const nextPhoneQ = opts.phoneQ ?? phoneQRef.current;
    const nextMonth = opts.month ?? monthRef.current;
    const nextTimeSort = "timeSort" in opts ? opts.timeSort : timeSortRef.current;
    const page = opts.page ?? 1;
    if (!quiet) {
      if (replace) setLoading(true);
      else setLoadingMore(true);
    }
    setError(null);
    try {
      const data = await fetchAntifraudList({
        filters: nextFilters,
        phoneQ: nextPhoneQ,
        month: nextMonth,
        timeSort: nextTimeSort,
        page,
        pageSize: TABLE_PAGE_SIZE,
      });
      setItems((current) => (replace ? data.items : [...current, ...data.items]));
      setTotal(data.total);
      setMonths(data.months);
      setUndatedCount(data.undatedCount);
      setGaps(data.gaps);
      setConfigured(data.configured);
      lastPassRef.current = data.lastPassAt;
      setLastPassAt(data.lastPassAt);
      setHadCalls(data.hadCalls);
      setLastCheckedAt(data.lastCheckedAt);
      setLastError(data.lastError);
      pageRef.current = data.page;
      return true;
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Не удалось загрузить журнал",
      );
      return false;
    } finally {
      if (!quiet) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let flight: Promise<void> | null = null;
    let again = false;

    const pull = async () => {
      const status = await fetchAntifraudStatus();
      if (cancelled || !status) return;
      setConfigured(status.configured);
      setHadCalls(status.hadCalls);
      setLastCheckedAt(status.lastCheckedAt);
      setLastError(status.lastError);
      setLastPassAt(status.lastPassAt);
      if (lastPassRef.current === status.lastPassAt) return;
      if (flight) {
        again = true;
        return;
      }
      const run = async () => {
        do {
          again = false;
          await loadList({ page: 1, replace: true, quiet: true });
        } while (again && !cancelled);
      };
      flight = run().finally(() => {
        flight = null;
      });
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
      }, STATUS_POLL_MS);
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
  }, [loadList]);

  const hasMore = items.length < total;
  const sentinelRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore,
    root: scrollRoot,
    onLoadMore: () => {
      void loadList({ page: pageRef.current + 1, replace: false });
    },
  });

  const monthOptions = useMemo(
    () => months.map((item) => ({ value: item.key, label: item.label })),
    [months],
  );
  const filtersActive =
    hasActiveFilters(filters) || Boolean(phoneQ) || timeSort !== "desc";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
            АнтиФрод
          </h1>
          <p className="text-muted-foreground text-sm">
            Запросы Access-Request из calls.log Parking. Это журнал запросов, не вердикт
            таймаута.
          </p>
        </div>
        {configured ? (
          lastPassAt ? (
            <LoadAgeChip
              lastPassAt={lastPassAt}
              hadCalls={hadCalls}
              lastCheckedAt={lastCheckedAt}
              colored
              labels={ANTIFRAUD_CLOCK_LABELS}
            />
          ) : (
            <p className="text-muted-foreground text-sm">Идёт первая загрузка</p>
          )
        ) : (
          <p className="text-muted-foreground max-w-sm text-right text-sm">
            Ключ Parking не загружен. После сохранения в настройках журнал читается сам,
            раз в минуту.
          </p>
        )}
      </div>
      {lastError ? <p className="text-destructive text-sm">{lastError}</p> : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {undatedCount > 0 ? (
        <p className="text-sm">
          Записей без даты: {undatedCount}. Они сохранены и не входят в месяц.
        </p>
      ) : null}
      {gaps.length > 0 ? (
        <ul className="text-sm">
          {gaps.map((gap) => (
            <li key={gap.id}>
              Дыра в файле, {gapLabel(gap.reason)}: байты {gap.fromOffset}–{gap.toOffset}
            </li>
          ))}
        </ul>
      ) : null}
      <div className={`flex flex-wrap items-center gap-2 ${FILTER_TOOLBAR_TEXT}`}>
        <PhoneSearchInput
          id="antifraud-phone-search"
          value={phoneInput}
          onChange={(value) => {
            setPhoneInput(value);
            if (phoneTimerRef.current) clearTimeout(phoneTimerRef.current);
            phoneTimerRef.current = setTimeout(() => {
              const next = value.trim();
              setPhoneQ(next);
              void loadList({ page: 1, replace: true, phoneQ: next });
            }, PHONE_SEARCH_DEBOUNCE_MS);
          }}
        />
        <FitSelect
          id="antifraud-month"
          aria-label="Месяц"
          textClassName={FILTER_TOOLBAR_TEXT}
          value={month}
          options={monthOptions}
          onChange={(next) => {
            setMonth(next);
            void loadList({ page: 1, replace: true, month: next });
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!filtersActive}
          onClick={() => {
            if (phoneTimerRef.current) clearTimeout(phoneTimerRef.current);
            setFilters({});
            setPhoneInput("");
            setPhoneQ("");
            setTimeSort("desc");
            void loadList({
              page: 1,
              replace: true,
              filters: {},
              phoneQ: "",
              timeSort: "desc",
            });
          }}
        >
          Сбросить фильтры
        </Button>
      </div>
      <ActiveFiltersBar
        filters={filters}
        headers={RADIUS_LABELS}
        phoneQuery={phoneQ}
        onClearPhoneQuery={() => {
          if (phoneTimerRef.current) clearTimeout(phoneTimerRef.current);
          setPhoneInput("");
          setPhoneQ("");
          void loadList({ page: 1, replace: true, phoneQ: "" });
        }}
        onRemoveFacet={(column, value) => {
          const next = setColumnFilterValues(
            filters,
            column,
            (filters[column] ?? []).filter((item) => item !== value),
          );
          setFilters(next);
          void loadList({ page: 1, replace: true, filters: next });
        }}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableInfiniteBody
          scrollRef={setScrollRoot}
          sentinelRef={sentinelRef}
          loadingMore={loadingMore}
        >
          <AntifraudTable
            data={items}
            loading={loading && items.length === 0}
            emptyMessage={
              filtersActive
                ? "Нет данных по текущим фильтрам. Сбросьте фильтры или уточните выбор."
                : "Нет данных."
            }
            filters={filters}
            phoneQ={phoneQ}
            month={month}
            openColumn={openColumn}
            onOpenColumnChange={setOpenColumn}
            onColumnFilterChange={(column, values) => {
              const next = setColumnFilterValues(filters, column, values);
              setFilters(next);
              setOpenColumn(null);
              void loadList({ page: 1, replace: true, filters: next });
            }}
            timeSort={timeSort}
            onTimeSortChange={(next) => {
              setTimeSort(next);
              void loadList({ page: 1, replace: true, timeSort: next });
            }}
          />
        </TableInfiniteBody>
        <TableCountFooter shown={items.length} total={total} />
      </div>
    </div>
  );
}
