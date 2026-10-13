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
import { encodeFilters } from "@/components/column-filters/types";
import { displayFacetValue } from "@/components/column-filters/types";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { FitSelect } from "@/components/fit-select";
import { PhoneSearchInput } from "@/components/phone-search-input";
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
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { downloadXlsxFromUrl } from "@/lib/download-xlsx";
import { SMG_FIELDS, SMG_HEADER_LABELS, SMG_PHONE_FIELDS } from "@/modules/smg/columns";
import { decideSmgRefresh } from "@/modules/smg/refresh";
import type { SmgListItem, SmgListResult, SmgStatus } from "@/modules/smg/service";
import { currentUtcMonth, parseMonthKey } from "@/modules/traffic/cdr-month";
import { formatMonthOption } from "@/modules/traffic/month-labels";

const PHONE_SEARCH_DEBOUNCE_MS = 300;
const STATUS_POLL_MS = 4000;
const PHONE_FIELDS = new Set<string>(SMG_PHONE_FIELDS);

type LoadOpts = {
  page?: number;
  replace?: boolean;
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  background?: boolean;
};

function readSmgStatus(body: unknown): SmgStatus | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (row.cursor !== null && typeof row.cursor !== "string") return null;
  if (typeof row.changed !== "boolean" || !Array.isArray(row.poisonFiles)) return null;
  const poisonFiles: SmgStatus["poisonFiles"] = [];
  for (const item of row.poisonFiles) {
    if (!item || typeof item !== "object") return null;
    const file = item as Record<string, unknown>;
    if (typeof file.filename !== "string" || typeof file.error !== "string") return null;
    poisonFiles.push({ filename: file.filename, error: file.error });
  }
  return { cursor: row.cursor, changed: row.changed, poisonFiles };
}

function buildListUrl(opts: {
  page: number;
  month: string;
  phoneQ: string;
  filters: ColumnFilters;
}): string {
  const params = new URLSearchParams();
  params.set("page", String(opts.page));
  params.set("month", opts.month);
  if (opts.phoneQ.trim()) params.set("phoneQ", opts.phoneQ.trim());
  const encoded = encodeFilters(opts.filters);
  if (encoded) params.set("filters", encoded);
  return `/api/smg?${params.toString()}`;
}

async function readJson(res: Response): Promise<SmgListResult | null> {
  try {
    return (await res.json()) as SmgListResult;
  } catch {
    return null;
  }
}

export function SmgView({
  canRetry,
  initial,
}: {
  canRetry: boolean;
  initial: SmgListResult;
}) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const [month, setMonth] = useState(initial.month || currentUtcMonth().key);
  const [months, setMonths] = useState(initial.months);
  const [openColumn, setOpenColumn] = useState<string | null>(null);
  const [page, setPage] = useState(initial.page);
  const [items, setItems] = useState<SmgListItem[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [poisonFiles, setPoisonFiles] = useState(initial.poisonFiles);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);
  const refreshSeq = useRef(0);
  const sinceRef = useRef<string | null>(null);
  const filtersRef = useRef(filters);
  const phoneQRef = useRef(phoneQ);
  const monthRef = useRef(month);
  const loadListRef = useRef<(opts?: LoadOpts) => Promise<void>>(async () => {});

  filtersRef.current = filters;
  phoneQRef.current = phoneQ;
  monthRef.current = month;

  const hasMore = items.length < total;

  const loadList = useCallback(async (opts: LoadOpts = {}) => {
    const background = opts.background ?? false;
    const nextPage = opts.page ?? 1;
    const replace = opts.replace ?? nextPage === 1;
    const nextFilters = opts.filters ?? filtersRef.current;
    const nextPhone = opts.phoneQ ?? phoneQRef.current;
    const nextMonth = opts.month ?? monthRef.current;
    const seq = ++refreshSeq.current;
    if (replace) {
      setLoading(true);
      setLoadingMore(false);
    } else {
      setLoadingMore(true);
    }
    if (!background) setListError(null);
    try {
      const res = await fetch(
        buildListUrl({
          page: nextPage,
          month: nextMonth,
          phoneQ: nextPhone,
          filters: nextFilters,
        }),
        { cache: "no-store" },
      );
      const data = await readJson(res);
      if (seq !== refreshSeq.current) return;
      if (!res.ok || !data) {
        if (!background) setListError("Не удалось загрузить звонки");
        return;
      }
      setPage(data.page);
      setTotal(data.total);
      setMonths(data.months);
      setPoisonFiles(data.poisonFiles);
      setItems((current) => (replace ? data.items : [...current, ...data.items]));
      setListError(null);
    } catch {
      if (seq !== refreshSeq.current) return;
      if (!background) setListError("Не удалось загрузить звонки");
    } finally {
      if (seq !== refreshSeq.current) return;
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);
  loadListRef.current = loadList;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = phoneInput.trim();
      if (next === phoneQ) return;
      setPhoneQ(next);
      void loadList({ page: 1, replace: true, phoneQ: next });
    }, PHONE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [phoneInput, phoneQ, loadList]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let pulling = false;

    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const pull = async () => {
      if (pulling) return;
      pulling = true;
      try {
        const params = new URLSearchParams();
        if (sinceRef.current) params.set("since", sinceRef.current);
        const query = params.toString();
        const res = await fetch(`/api/smg/status${query ? `?${query}` : ""}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        const body = await res.json().catch(() => null);
        const status = res.ok ? readSmgStatus(body) : null;
        const decision = decideSmgRefresh({
          ok: status != null,
          since: sinceRef.current,
          cursor: status?.cursor ?? null,
          changed: status?.changed ?? false,
        });
        if (cancelled) return;
        sinceRef.current = decision.since;
        if (status) setPoisonFiles(status.poisonFiles);
        if (decision.reload) {
          void loadListRef.current({ page: 1, replace: true, background: true });
        }
      } catch {
        // Leave the cursor so the next poll can still see the missed import.
      } finally {
        pulling = false;
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
  }, []);

  const onLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) return;
    void loadList({ page: page + 1, replace: false });
  }, [hasMore, loading, loadingMore, loadList, page]);

  const sentinelRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !listError,
    onLoadMore,
    root: scrollRoot,
  });

  async function onDownload(filename: string) {
    setDownloading(filename);
    const result = await downloadXlsxFromUrl(
      `/api/smg/inbox/${encodeURIComponent(filename)}`,
      filename,
    );
    setDownloading(null);
    if (!result.ok) toast.error(result.message);
  }

  async function onRetry() {
    setPending(true);
    try {
      const res = await fetch("/api/smg/retry", { method: "POST" });
      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        toast.error(body.error ?? body.message ?? "Не удалось повторить импорт");
        return;
      }
      toast.success(body.message ?? "Импорт запущен");
      await loadList({ page: 1, replace: true });
    } catch {
      toast.error("Не удалось повторить импорт");
    } finally {
      setPending(false);
    }
  }

  const monthOptions = months.map((item) => ({
    value: item.key,
    label: formatMonthOption(item.year, item.month, item.count),
  }));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
            Звонки на SMG
          </h1>
          <p className="text-muted-foreground text-sm">
            CDR цифровых шлюзов Eltex SMG-1016M из локальной базы.
          </p>
        </div>
        {canRetry ? (
          <Button type="button" onClick={() => void onRetry()} disabled={pending}>
            {pending ? "Импорт…" : "Повторить импорт"}
          </Button>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <PhoneSearchInput
          id="smg-phone-search"
          value={phoneInput}
          onChange={setPhoneInput}
        />
        <FitSelect
          id="smg-month"
          aria-label="Месяц"
          textClassName={FILTER_TOOLBAR_TEXT}
          value={month}
          options={monthOptions}
          onChange={(nextKey) => {
            if (!parseMonthKey(nextKey)) return;
            setMonth(nextKey);
            void loadList({ page: 1, replace: true, month: nextKey });
          }}
        />
      </div>

      {hasActiveFilters(filters) || phoneQ ? (
        <ActiveFiltersBar
          filters={filters}
          headers={SMG_HEADER_LABELS}
          phoneQuery={phoneQ}
          onClearPhoneQuery={() => {
            setPhoneInput("");
            setPhoneQ("");
            void loadList({ page: 1, replace: true, phoneQ: "" });
          }}
          onRemoveFacet={(field, value) => {
            const next = removeFacetValue(filters, field, value);
            setFilters(next);
            void loadList({ page: 1, replace: true, filters: next });
          }}
        />
      ) : null}

      {poisonFiles.length > 0 ? (
        <ul
          className="border-destructive/30 bg-destructive/10 text-destructive shrink-0 list-none space-y-1 rounded-md border px-3 py-2 text-sm"
          aria-label="Файлы с ошибкой импорта"
        >
          {poisonFiles.map((file) => (
            <li key={file.filename} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{file.filename}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={downloading === file.filename}
                  onClick={() => void onDownload(file.filename)}
                >
                  Скачать
                </Button>
              </div>
              <p>{file.error}</p>
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
        </div>
      ) : null}

      <TableInfiniteBody
        scrollRef={setScrollRoot}
        sentinelRef={sentinelRef}
        loadingMore={loadingMore}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {SMG_FIELDS.map((field) => (
                <TableHead key={field} className="font-medium">
                  <ColumnFilterDropdown
                    column={field}
                    header={SMG_HEADER_LABELS[field]}
                    open={openColumn === field}
                    selected={filters[field] ?? []}
                    filters={filters}
                    buildFacetsUrl={({ column, filters: nextFilters, q }) => {
                      const params = new URLSearchParams();
                      params.set("column", column);
                      params.set("month", month);
                      if (phoneQ.trim()) params.set("phoneQ", phoneQ.trim());
                      if (q.trim()) params.set("q", q.trim());
                      const encoded = encodeFilters(nextFilters);
                      if (encoded) params.set("filters", encoded);
                      return `/api/smg/facets?${params.toString()}`;
                    }}
                    formatValue={displayFacetValue}
                    onToggle={() =>
                      setOpenColumn(openColumn === field ? null : field)
                    }
                    onChange={(values) => {
                      const next = setColumnFilterValues(filters, field, values);
                      setFilters(next);
                      void loadList({ page: 1, replace: true, filters: next });
                    }}
                    onClear={() => {
                      const next = setColumnFilterValues(filters, field, []);
                      setFilters(next);
                      void loadList({ page: 1, replace: true, filters: next });
                    }}
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={SMG_FIELDS.length}
                  className="text-muted-foreground h-24"
                >
                  Загрузка…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={SMG_FIELDS.length}
                  className="text-muted-foreground h-24"
                >
                  {hasActiveFilters(filters) || phoneQ
                    ? "Нет данных по текущим фильтрам. Сбросьте фильтры или уточните выбор."
                    : "Нет данных."}
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow key={row.id}>
                  {SMG_FIELDS.map((field) => (
                    <TableCell
                      key={field}
                      className={
                        PHONE_FIELDS.has(field) ? "font-medium tabular-nums" : undefined
                      }
                    >
                      {row[field]}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableInfiniteBody>
      <TableCountFooter shown={items.length} total={total} />
    </div>
  );
}
