"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";
import {
  ActiveFiltersBar,
  ColumnFilterDropdown,
  hasActiveFilters,
  removeFacetValue,
  setColumnFilterValues,
  type ColumnFilters,
} from "@/components/column-filters";
import { displayFacetValue } from "@/components/column-filters/types";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { EXPORT_XLSX_BUTTON_CLASS } from "@/components/export-xlsx-button-class";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { FitSelect } from "@/components/fit-select";
import { HighlightText } from "@/components/highlight-text";
import { PhoneSearchInput } from "@/components/phone-search-input";
import { TableCountFooter, TableInfiniteBody } from "@/components/table-infinite-body";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { downloadXlsxFromUrl } from "@/lib/download-xlsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount } from "@/lib/format-count";
import { formatDisplayTimestamp } from "@/lib/format-display-time";
import { geographyAppendAllowed } from "@/modules/rtu/paging";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import {
  buildMarkingFacetsUrl,
  fetchMarkingList,
  fetchMarkingStats,
  importMarkingFile,
} from "@/modules/marking/api-client";
import {
  MARKING_COLUMN_HEADERS,
  MARKING_COLUMN_ORDER,
  markingCellText,
  type MarkingColumnId,
} from "@/modules/marking/query-filter";
import type { MarkingListItem } from "@/modules/marking/service";
import type { MarkingStatsSnapshot } from "@/modules/marking/stats";
import {
  sortMarkingStatsRows,
  type MarkingStatsNetworkSort,
} from "@/modules/marking/stats-sort";
import { MarkingStatsTable } from "@/modules/marking/ui/marking-stats-table";
import { markingStatsFailureClearsRows } from "@/modules/marking/stats-hold";
import { formatMonthOption } from "@/modules/traffic/month-labels";

const PAGE_SIZE = TABLE_PAGE_SIZE;
const PHONE_SEARCH_DEBOUNCE_MS = 300;
const PHONE_CELL = "font-mono font-bold text-black dark:text-white";

type ImportError = { error: string; details: string[] };

function formatLoadedLine(
  preparing: boolean,
  loadedAt: string | null,
  rowCount: number,
  timeZone: string,
): string {
  if (preparing) return "Снимок «Управление РТУ» ещё не собран.";
  const count = `Номеров: ${formatCount(rowCount)}.`;
  if (!loadedAt) return `${count} Метки ещё не загружались.`;
  return `${count} Метки загружены: ${formatDisplayTimestamp(loadedAt, timeZone)}.`;
}

export function MarkingView({
  initialStats,
  initialStatsError = null,
}: {
  initialStats: MarkingStatsSnapshot;
  initialStatsError?: string | null;
}) {
  const { timeZone } = useDisplayTimezone();
  const [statsOn, setStatsOn] = useState(true);
  const [stats, setStats] = useState(initialStats);
  const [statsError, setStatsError] = useState<string | null>(initialStatsError);
  const [statsLoading, setStatsLoading] = useState(false);
  const [sortKey, setSortKey] = useState<MarkingStatsNetworkSort | null>(null);
  const [shown, setShown] = useState(TABLE_PAGE_SIZE);

  const [items, setItems] = useState<MarkingListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [listReady, setListReady] = useState(false);
  const catalogStampRef = useRef("0");
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const [openColumn, setOpenColumn] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [listError, setListError] = useState<string | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refreshSeq = useRef(0);
  const statsSeq = useRef(0);
  const filtersRef = useRef(filters);
  const phoneQRef = useRef(phoneQ);
  const statsRef = useRef(stats);
  const statsOnRef = useRef(statsOn);
  const listLoadedRef = useRef(false);
  const listDirtyRef = useRef(false);
  const statsStaleRef = useRef(false);
  const phoneSearchTimerRef = useRef<number | null>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);

  const filtersActive = hasActiveFilters(filters) || phoneQ.trim().length > 0;
  const hasMore = items.length < total;

  useEffect(() => {
    filtersRef.current = filters;
    phoneQRef.current = phoneQ;
    statsRef.current = stats;
    statsOnRef.current = statsOn;
  });

  useEffect(() => {
    return () => {
      if (phoneSearchTimerRef.current != null) {
        window.clearTimeout(phoneSearchTimerRef.current);
      }
    };
  }, []);

  const monthOptions = stats.months;

  const monthSelectOptions = useMemo(
    () =>
      monthOptions.map((item) => ({
        value: item.key,
        label: formatMonthOption(item.year, item.month),
      })),
    [monthOptions],
  );

  const sortedStats = useMemo(
    () => sortMarkingStatsRows(stats.rows, sortKey),
    [stats.rows, sortKey],
  );
  const visibleStats = sortedStats.slice(0, shown);

  async function loadStats(month: string, opts: { resetSort?: boolean } = {}) {
    const seq = ++statsSeq.current;
    setStatsLoading(true);
    const result = await fetchMarkingStats(month);
    if (seq !== statsSeq.current) return;
    setStatsLoading(false);
    statsStaleRef.current = false;
    if (!result.ok) {
      setStatsError(result.message);
      if (markingStatsFailureClearsRows(result.message)) {
        setStats((current) => ({ ...current, rows: [], rowCount: 0 }));
      }
      return;
    }
    setStatsError(null);
    setStats(result.data);
    if (opts.resetSort) {
      setSortKey(null);
      setShown(TABLE_PAGE_SIZE);
    }
  }

  async function loadList(opts: {
    replace?: boolean;
    filters?: ColumnFilters;
    phoneQ?: string;
    cursor?: string;
  }) {
    const replace = opts.replace ?? true;
    const nextFilters = opts.filters ?? filtersRef.current;
    const nextPhoneQ = opts.phoneQ !== undefined ? opts.phoneQ : phoneQRef.current;
    const seq = ++refreshSeq.current;

    if (replace) {
      setLoading(true);
      loadingMoreRef.current = false;
      setLoadingMore(false);
      listDirtyRef.current = false;
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    setListError(null);

    const result = await fetchMarkingList({
      pageSize: PAGE_SIZE,
      filters: nextFilters,
      phoneQ: nextPhoneQ,
      cursor: replace ? undefined : opts.cursor,
    });
    if (seq !== refreshSeq.current) return;

    if (!result.ok) {
      if (replace) {
        setItems([]);
        setTotal(0);
        setListReady(true);
      }
      setListError(result.message);
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      return;
    }

    const nextStamp = result.data.catalogStamp;
    if (!replace && !geographyAppendAllowed(catalogStampRef.current, nextStamp)) {
      void loadListRef.current({
        replace: true,
        filters: nextFilters,
        phoneQ: nextPhoneQ,
      });
      return;
    }
    catalogStampRef.current = nextStamp;
    listLoadedRef.current = true;
    setListReady(true);
    setTotal(result.data.total);
    setLoadedAt(result.data.loadedAt);
    setRowCount(result.data.rowCount);
    setPreparing(result.data.preparing);
    setItems((prev) => (replace ? result.data.items : [...prev, ...result.data.items]));
    setLoading(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }

  const loadListRef = useRef(loadList);
  const loadStatsRef = useRef(loadStats);
  useEffect(() => {
    loadListRef.current = loadList;
    loadStatsRef.current = loadStats;
  });

  useEffect(() => {
    if (!statsOn) return;
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      void loadStatsRef.current(statsRef.current.month);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [statsOn]);

  const onLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMoreRef.current) return;
    const cursor = items[items.length - 1]?.phoneNumber;
    if (!cursor) return;
    void loadListRef.current({ cursor, replace: false });
  }, [hasMore, loading, items]);

  const loadMoreStats = useCallback(() => {
    setShown((current) => Math.min(sortedStats.length, current + TABLE_PAGE_SIZE));
  }, [sortedStats.length]);

  const sentinelRef = useInfiniteScroll({
    enabled: !statsOn && hasMore && !loading && !loadingMore && !listError,
    onLoadMore,
    root: scrollRoot,
  });

  const statsSentinelRef = useInfiniteScroll({
    enabled: statsOn && shown < sortedStats.length,
    onLoadMore: loadMoreStats,
    root: scrollRoot,
  });

  function applyFilters(next: ColumnFilters, opts: { closeDropdown?: boolean } = {}) {
    filtersRef.current = next;
    setFilters(next);
    if (opts.closeDropdown) setOpenColumn(null);
    void loadList({ filters: next, replace: true });
  }

  function onColumnFilterChange(column: string, values: string[]) {
    applyFilters(setColumnFilterValues(filtersRef.current, column, values));
  }

  function clearPhoneTimer() {
    if (phoneSearchTimerRef.current != null) {
      window.clearTimeout(phoneSearchTimerRef.current);
      phoneSearchTimerRef.current = null;
    }
  }

  function onPhoneInputChange(value: string) {
    setPhoneInput(value);
    clearPhoneTimer();
    phoneSearchTimerRef.current = window.setTimeout(() => {
      const next = value.trim();
      phoneQRef.current = next;
      setPhoneQ(next);
      void loadListRef.current({ phoneQ: next, replace: true });
    }, PHONE_SEARCH_DEBOUNCE_MS);
  }

  function onPhoneKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      clearPhoneTimer();
      const next = event.currentTarget.value.trim();
      phoneQRef.current = next;
      setPhoneQ(next);
      void loadList({ phoneQ: next, replace: true });
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClearPhoneQuery();
    }
  }

  function onClearPhoneQuery() {
    clearPhoneTimer();
    setPhoneInput("");
    phoneQRef.current = "";
    setPhoneQ("");
    void loadList({ phoneQ: "", replace: true });
  }

  function onResetFilters() {
    clearPhoneTimer();
    setPhoneInput("");
    setPhoneQ("");
    phoneQRef.current = "";
    filtersRef.current = {};
    setFilters({});
    setOpenColumn(null);
    void loadList({ filters: {}, phoneQ: "", replace: true });
  }

  function onStatsChange(checked: boolean) {
    setStatsOn(checked);
    if (checked) {
      if (statsStaleRef.current) void loadStatsRef.current(statsRef.current.month);
      return;
    }
    if (!listLoadedRef.current || listDirtyRef.current) {
      void loadListRef.current({ replace: true });
    }
  }

  function onSort(next: MarkingStatsNetworkSort) {
    setSortKey(next);
    setShown(TABLE_PAGE_SIZE);
  }

  async function onExport() {
    if (exporting || uploading) return;
    setExporting(true);
    const result = await downloadXlsxFromUrl("/api/marking/export", "marking.xlsx");
    setExporting(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Файл экспорта скачан");
  }

  async function onFileSelected(list: FileList | null) {
    const file = list?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file || uploading || exporting) return;
    setUploading(true);
    setImportError(null);
    const result = await importMarkingFile(file);
    setUploading(false);
    if (!result.ok) {
      setImportError({ error: result.error, details: result.details });
      toast.error(result.error);
      return;
    }
    toast.success(`Загружено строк: ${formatCount(result.rowCount)}`);
    if (statsOnRef.current) {
      await loadStatsRef.current(statsRef.current.month);
    } else {
      statsStaleRef.current = true;
    }
    if (statsOnRef.current) listDirtyRef.current = true;
    else await loadListRef.current({ replace: true });
  }

  const showEmpty = !loading && items.length === 0;
  const emptyMessage = preparing
    ? "Снимок «Управление РТУ» ещё не собран."
    : filtersActive
      ? "Нет строк по текущим фильтрам."
      : "Нет номеров в рабочем наборе.";
  const subtitle = statsOn
    ? formatLoadedLine(stats.preparing, stats.loadedAt, stats.rowCount, timeZone)
    : listReady
      ? formatLoadedLine(preparing, loadedAt, rowCount, timeZone)
      : "Загрузка…";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
            Маркировка и МАВ
          </h1>
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statsOn ? (
            <FitSelect
              id="marking-stats-month"
              value={stats.month}
              options={monthSelectOptions}
              onChange={(value) => void loadStats(value, { resetSort: true })}
              disabled={statsLoading}
              aria-label="Календарный месяц"
              textClassName="text-sm"
            />
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => void onFileSelected(event.target.files)}
          />
          <Button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || exporting}
          >
            {uploading ? "Импорт…" : "Импорт XLSX"}
          </Button>
          <Button
            type="button"
            className={EXPORT_XLSX_BUTTON_CLASS}
            onClick={() => void onExport()}
            disabled={exporting || uploading}
          >
            {exporting ? "Экспорт…" : "Экспорт XLSX"}
          </Button>
        </div>
      </div>

      {importError ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive flex min-h-0 shrink-0 flex-col rounded-md border px-3 py-2 text-sm"
        >
          <p className="shrink-0 font-medium">{importError.error}</p>
          <ul className="mt-1 max-h-[min(40vh,20rem)] list-disc space-y-0.5 overflow-y-auto pl-5">
            {importError.details.map((detail, index) => (
              <li key={`${index}-${detail.slice(0, 48)}`}>{detail}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {statsOn && statsError ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive shrink-0 rounded-md border px-3 py-2 text-sm"
        >
          {statsError}
        </div>
      ) : null}

      {!statsOn && listError ? (
        <p className="text-destructive shrink-0 text-sm">{listError}</p>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {!statsOn ? (
          <PhoneSearchInput
            id="marking-phone"
            value={phoneInput}
            onChange={onPhoneInputChange}
            busy={loading}
            onKeyDown={onPhoneKeyDown}
          />
        ) : null}
        {!statsOn ? (
          <Button
            type="button"
            variant="outline"
            className={FILTER_TOOLBAR_TEXT}
            disabled={!filtersActive}
            onClick={onResetFilters}
          >
            Сбросить фильтры
          </Button>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Label
            htmlFor="marking-stats"
            className={`${FILTER_TOOLBAR_TEXT} whitespace-nowrap`}
          >
            Статистика Маркировки
          </Label>
          <Switch id="marking-stats" checked={statsOn} onCheckedChange={onStatsChange} />
        </div>
      </div>

      {!statsOn ? (
        <ActiveFiltersBar
          filters={filters}
          headers={MARKING_COLUMN_HEADERS}
          formatValue={(_field, value) => displayFacetValue(value)}
          phoneQuery={phoneQ}
          onClearPhoneQuery={onClearPhoneQuery}
          onRemoveFacet={(field, value) =>
            applyFilters(removeFacetValue(filtersRef.current, field, value), {
              closeDropdown: true,
            })
          }
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {statsOn ? (
          <>
            <TableInfiniteBody scrollRef={setScrollRoot} sentinelRef={statsSentinelRef}>
              <MarkingStatsTable
                rows={visibleStats}
                sortKey={sortKey}
                onSort={onSort}
                preparing={stats.preparing}
              />
            </TableInfiniteBody>
            <TableCountFooter shown={visibleStats.length} total={sortedStats.length} />
          </>
        ) : (
          <>
            <TableInfiniteBody
              scrollRef={setScrollRoot}
              sentinelRef={sentinelRef}
              loadingMore={loadingMore}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    {MARKING_COLUMN_ORDER.map((id) => (
                      <MarkingColumnHead
                        key={id}
                        id={id}
                        filters={filters}
                        phoneQ={phoneQ}
                        openColumn={openColumn}
                        onOpenColumnChange={setOpenColumn}
                        onColumnFilterChange={onColumnFilterChange}
                      />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={MARKING_COLUMN_ORDER.length}
                        className="text-muted-foreground h-24"
                      >
                        Загрузка…
                      </TableCell>
                    </TableRow>
                  ) : showEmpty ? (
                    <TableRow>
                      <TableCell
                        colSpan={MARKING_COLUMN_ORDER.length}
                        className="text-muted-foreground h-24"
                      >
                        {emptyMessage}
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((row) => (
                      <TableRow key={row.id}>
                        {MARKING_COLUMN_ORDER.map((id) => (
                          <TableCell
                            key={id}
                            className={id === "phoneNumber" ? PHONE_CELL : undefined}
                          >
                            {id === "phoneNumber" ? (
                              <HighlightText
                                text={markingCellText(row, id)}
                                query={phoneQ}
                              />
                            ) : (
                              markingCellText(row, id)
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableInfiniteBody>
            <TableCountFooter shown={items.length} total={total} />
          </>
        )}
      </div>
    </div>
  );
}

function MarkingColumnHead({
  id,
  filters,
  phoneQ,
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
}: {
  id: MarkingColumnId;
  filters: ColumnFilters;
  phoneQ: string;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
}) {
  return (
    <TableHead className="font-medium">
      <ColumnFilterDropdown
        column={id}
        header={MARKING_COLUMN_HEADERS[id]}
        open={openColumn === id}
        selected={filters[id] ?? []}
        filters={filters}
        buildFacetsUrl={({ column, filters: nextFilters, q }) =>
          buildMarkingFacetsUrl({ column, filters: nextFilters, phoneQ, q })
        }
        onToggle={() => onOpenColumnChange(openColumn === id ? null : id)}
        onChange={(values) => onColumnFilterChange(id, values)}
        onClear={() => onColumnFilterChange(id, [])}
      />
    </TableHead>
  );
}
