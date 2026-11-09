"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ActiveFiltersBar,
  ColumnFilterDropdown,
  hasActiveFilters,
  removeFacetValue,
  setColumnFilterValues,
  type ColumnFilters,
} from "@/components/column-filters";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { EXPORT_XLSX_BUTTON_CLASS } from "@/components/export-xlsx-button-class";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { TableCountFooter, TableInfiniteBody } from "@/components/table-infinite-body";
import { Button } from "@/components/ui/button";
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
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import {
  buildTariffsFacetsUrl,
  fetchTariffsList,
  importTariffsFile,
} from "@/modules/tariffs/api-client";
import {
  TARIFF_COLUMN_HEADERS,
  TARIFF_COLUMN_ORDER,
  tariffCellText,
  type TariffColumnId,
} from "@/modules/tariffs/query-filter";
import type { ListTariffsResult, TariffListItem } from "@/modules/tariffs/service";
import { isRussianAbc } from "@/modules/traffic/tariff-match";

const PAGE_SIZE = TABLE_PAGE_SIZE;

type ImportError = { error: string; details: string[] };

function formatLoadedLine(
  loadedAt: string | null,
  rowCount: number,
  timeZone: string,
): string {
  if (!loadedAt) return "Данные ещё не загружены.";
  return `Загружено: ${formatDisplayTimestamp(loadedAt, timeZone)}. Строк: ${formatCount(rowCount)}.`;
}

export function TariffsView({ initial }: { initial: ListTariffsResult }) {
  const { timeZone } = useDisplayTimezone();
  const [items, setItems] = useState<TariffListItem[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [page, setPage] = useState(initial.page);
  const [loadedAt, setLoadedAt] = useState(initial.loadedAt);
  const [rowCount, setRowCount] = useState(initial.rowCount);
  const [filters, setFilters] = useState<ColumnFilters>({});
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
  const filtersRef = useRef(filters);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);

  const hasMore = items.length < total;
  const filtersActive = hasActiveFilters(filters);

  useEffect(() => {
    filtersRef.current = filters;
  });

  async function loadList(opts: {
    page?: number;
    replace?: boolean;
    filters?: ColumnFilters;
  }) {
    const replace = opts.replace ?? true;
    const nextPage = opts.page ?? (replace ? 1 : page);
    const nextFilters = opts.filters ?? filtersRef.current;
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

    const result = await fetchTariffsList({
      page: nextPage,
      pageSize: PAGE_SIZE,
      filters: nextFilters,
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
    setLoadedAt(result.data.loadedAt);
    setRowCount(result.data.rowCount);
    setItems((prev) => (replace ? result.data.items : [...prev, ...result.data.items]));
    setLoading(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }

  const loadListRef = useRef(loadList);
  useEffect(() => {
    loadListRef.current = loadList;
  });

  const onLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMoreRef.current) return;
    void loadListRef.current({ page: page + 1, replace: false });
  }, [hasMore, loading, page]);

  const sentinelRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !listError,
    onLoadMore,
    root: scrollRoot,
  });

  function applyFilters(next: ColumnFilters, opts: { closeDropdown?: boolean } = {}) {
    filtersRef.current = next;
    setFilters(next);
    if (opts.closeDropdown) setOpenColumn(null);
    void loadList({ filters: next, page: 1, replace: true });
  }

  function onColumnFilterChange(column: string, values: string[]) {
    applyFilters(setColumnFilterValues(filtersRef.current, column, values));
  }

  function onResetFilters() {
    applyFilters({}, { closeDropdown: true });
  }

  async function onExport() {
    if (exporting || uploading) return;
    setExporting(true);
    const result = await downloadXlsxFromUrl("/api/tariffs/export", "tariffs.xlsx");
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
    const result = await importTariffsFile(file);
    setUploading(false);
    if (!result.ok) {
      setImportError({ error: result.error, details: result.details });
      toast.error(result.error);
      return;
    }
    toast.success(`Загружено строк: ${formatCount(result.rowCount)}`);
    await loadList({ page: 1, replace: true });
  }

  const showEmpty = !loading && items.length === 0;
  const emptyMessage = filtersActive
    ? "Нет строк по текущим фильтрам."
    : "Нет данных. Нажмите «Импорт XLSX».";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
            Тарификация
          </h1>
          <p className="text-muted-foreground text-sm">
            {formatLoadedLine(loadedAt, rowCount, timeZone)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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

      {listError ? (
        <p className="text-destructive shrink-0 text-sm">{listError}</p>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-3">
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

      <ActiveFiltersBar
        filters={filters}
        headers={TARIFF_COLUMN_HEADERS}
        onRemoveFacet={(field, value) =>
          applyFilters(removeFacetValue(filtersRef.current, field, value), {
            closeDropdown: true,
          })
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableInfiniteBody
          scrollRef={setScrollRoot}
          sentinelRef={sentinelRef}
          loadingMore={loadingMore}
        >
          <Table>
            <TableHeader>
              <TableRow>
                {TARIFF_COLUMN_ORDER.map((id) => (
                  <TariffColumnHead
                    key={id}
                    id={id}
                    filters={filters}
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
                    colSpan={TARIFF_COLUMN_ORDER.length}
                    className="text-muted-foreground h-24"
                  >
                    Загрузка…
                  </TableCell>
                </TableRow>
              ) : showEmpty ? (
                <TableRow>
                  <TableCell
                    colSpan={TARIFF_COLUMN_ORDER.length}
                    className="text-muted-foreground h-24"
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => (
                  <TableRow
                    key={row.id}
                    className={isRussianAbc(row.abc) ? undefined : "font-bold"}
                  >
                    {TARIFF_COLUMN_ORDER.map((id) => (
                      <TableCell key={id}>{tariffCellText(row, id)}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableInfiniteBody>
        <TableCountFooter shown={items.length} total={total} />
      </div>
    </div>
  );
}

function TariffColumnHead({
  id,
  filters,
  openColumn,
  onOpenColumnChange,
  onColumnFilterChange,
}: {
  id: TariffColumnId;
  filters: ColumnFilters;
  openColumn: string | null;
  onOpenColumnChange: (column: string | null) => void;
  onColumnFilterChange: (column: string, values: string[]) => void;
}) {
  return (
    <TableHead className="font-medium">
      <ColumnFilterDropdown
        column={id}
        header={TARIFF_COLUMN_HEADERS[id]}
        open={openColumn === id}
        selected={filters[id] ?? []}
        filters={filters}
        buildFacetsUrl={({ column, filters: nextFilters, q }) =>
          buildTariffsFacetsUrl({ column, filters: nextFilters, q })
        }
        onToggle={() => onOpenColumnChange(openColumn === id ? null : id)}
        onChange={(values) => onColumnFilterChange(id, values)}
        onClear={() => onColumnFilterChange(id, [])}
      />
    </TableHead>
  );
}
