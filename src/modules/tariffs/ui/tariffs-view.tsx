"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { TableCountFooter, TableInfiniteBody } from "@/components/table-infinite-body";
import { Button } from "@/components/ui/button";
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
import { fetchTariffsList, importTariffsFile } from "@/modules/tariffs/api-client";
import type { ListTariffsResult, TariffListItem } from "@/modules/tariffs/service";

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
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [listError, setListError] = useState<string | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refreshSeq = useRef(0);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);

  const hasMore = items.length < total;

  async function loadList(opts: { page?: number; replace?: boolean }) {
    const replace = opts.replace ?? true;
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

    const result = await fetchTariffsList({ page: nextPage, pageSize: PAGE_SIZE });
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
  loadListRef.current = loadList;

  const onLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMoreRef.current) return;
    void loadListRef.current({ page: page + 1, replace: false });
  }, [hasMore, loading, page]);

  const sentinelRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !listError,
    onLoadMore,
    root: scrollRoot,
  });

  async function onFileSelected(list: FileList | null) {
    const file = list?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file || uploading) return;
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
        <div>
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
            disabled={uploading}
          >
            {uploading ? "Загрузка…" : "Загрузить данные"}
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableInfiniteBody
          scrollRef={setScrollRoot}
          sentinelRef={sentinelRef}
          loadingMore={loadingMore}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Направления</TableHead>
                <TableHead>ABC</TableHead>
                <TableHead>Цена</TableHead>
                <TableHead>Себестоимость</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground h-24">
                    Загрузка…
                  </TableCell>
                </TableRow>
              ) : showEmpty ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground h-24">
                    Нет данных. Нажмите «Загрузить данные».
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.direction}</TableCell>
                    <TableCell>{row.abc}</TableCell>
                    <TableCell>{row.price}</TableCell>
                    <TableCell>{row.cost}</TableCell>
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
