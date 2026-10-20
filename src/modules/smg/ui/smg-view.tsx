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
import { EMPTY_FILTER_TOKEN, encodeFilters } from "@/components/column-filters/types";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { FitSelect } from "@/components/fit-select";
import { HighlightText } from "@/components/highlight-text";
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
import { formatCount } from "@/lib/format-count";
import {
  isSmgField,
  SMG_FIELDS,
  SMG_HEADER_LABELS,
  SMG_PHONE_FIELDS,
} from "@/modules/smg/columns";
import { formatSmgPoisonSummary, smgSummaryCellText } from "@/modules/smg/summary";
import { formatCdrDayDisplay } from "@/modules/traffic/cdr-date-parts";
import {
  nextTimeSort,
  timeSortChevron,
  type TimeSort,
} from "@/modules/traffic/traffic-sort";
import { SmgCallTraceSheet } from "@/modules/smg/ui/call-trace-sheet";
import type { TraceLookup } from "@/modules/smg-trace/types";
import { decideSmgRefresh } from "@/modules/smg/refresh";
import type { SmgListItem, SmgListResult, SmgStatus } from "@/modules/smg/service";
import { LoadAgeChip } from "@/modules/traffic/ui/load-age-chip";
import { currentUtcMonth, parseMonthKey } from "@/modules/traffic/cdr-month";
import { formatMonthOption } from "@/modules/traffic/month-labels";

const PHONE_SEARCH_DEBOUNCE_MS = 300;
const STATUS_POLL_MS = 4000;
const PHONE_FIELDS = new Set<string>(SMG_PHONE_FIELDS);
const BOLD_PHONE_FIELDS = new Set<string>(["outgoingCgpn", "outgoingCdpn"]);
const TABULAR_COLUMNS = new Set<string>([
  "setupDay",
  "setupClock",
  "connectClock",
  "disconnectClock",
  "duration",
  "billableMinutes",
]);

type LoadOpts = {
  page?: number;
  replace?: boolean;
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  device?: string;
  includeDevices?: boolean;
  background?: boolean;
  setupSort?: TimeSort | null;
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
  return {
    cursor: row.cursor,
    changed: row.changed,
    poisonFiles,
    lastPassAt: readLastPassAt(row),
    hadCalls: row.hadCalls === true,
    lastCheckedAt: readLastPassAt({ lastPassAt: row.lastCheckedAt }),
  };
}

function readLastPassAt(row: Record<string, unknown>): string | null {
  if (row.lastPassAt === null || typeof row.lastPassAt === "string")
    return row.lastPassAt;
  return null;
}

function buildListUrl(opts: {
  page: number;
  month: string;
  device: string;
  phoneQ: string;
  filters: ColumnFilters;
  includeDevices: boolean;
  setupSort: TimeSort | null;
}): string {
  const params = new URLSearchParams();
  params.set("page", String(opts.page));
  params.set("month", opts.month);
  if (opts.device) params.set("device", opts.device);
  if (opts.includeDevices) params.set("devices", "1");
  if (opts.phoneQ.trim()) params.set("phoneQ", opts.phoneQ.trim());
  if (opts.setupSort) params.set("setupSort", opts.setupSort);
  const encoded = encodeFilters(opts.filters);
  if (encoded) params.set("filters", encoded);
  return `/api/smg?${params.toString()}`;
}

function formatSmgFacet(column: string, value: string): string {
  if (value === "" || value === EMPTY_FILTER_TOKEN) return "(пусто)";
  if (column === "setupDay") return formatCdrDayDisplay(value);
  return value;
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
  initialSince,
  title = "Звонки на SMG",
  subtitle = "CDR цифровых шлюзов Eltex SMG-1016M из локальной базы.",
  columns = SMG_FIELDS,
  headerLabels = SMG_HEADER_LABELS,
  showOps = true,
  searchInputId = "smg-phone-search",
  highlightPhones = false,
  facetColumns = null,
  exportLayout,
}: {
  canRetry: boolean;
  initial: SmgListResult;
  initialSince: string | null;
  title?: string;
  subtitle?: string;
  columns?: readonly string[];
  headerLabels?: Record<string, string>;
  showOps?: boolean;
  searchInputId?: string;
  highlightPhones?: boolean;
  /** Null keeps a facet on every CDR field except the gateway. */
  facetColumns?: readonly string[] | null;
  exportLayout: "calls" | "traffic";
}) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [setupSort, setSetupSort] = useState<TimeSort | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const [month, setMonth] = useState(initial.month || currentUtcMonth().key);
  const [months, setMonths] = useState(initial.months);
  const [device, setDevice] = useState(initial.device);
  const [devices, setDevices] = useState(initial.devices ?? []);
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
  const [loadAge, setLoadAge] = useState<{
    lastPassAt: string | null;
    hadCalls: boolean;
    lastCheckedAt: string | null;
  } | null>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);
  const [traceRow, setTraceRow] = useState<SmgListItem | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceLookup | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const traceRequest = useRef(0);
  const refreshSeq = useRef(0);
  const sinceRef = useRef<string | null>(initialSince);
  const baselineEmptyRef = useRef(initialSince == null);
  const filtersRef = useRef(filters);
  const setupSortRef = useRef(setupSort);
  const phoneQRef = useRef(phoneQ);
  const monthRef = useRef(month);
  const deviceRef = useRef(device);
  const loadListRef = useRef<(opts?: LoadOpts) => Promise<void>>(async () => {});

  filtersRef.current = filters;
  setupSortRef.current = setupSort;
  phoneQRef.current = phoneQ;
  monthRef.current = month;
  deviceRef.current = device;

  const hasMore = items.length < total;

  const loadList = useCallback(async (opts: LoadOpts = {}) => {
    const background = opts.background ?? false;
    const nextPage = opts.page ?? 1;
    const replace = opts.replace ?? nextPage === 1;
    const nextFilters = opts.filters ?? filtersRef.current;
    const nextPhone = opts.phoneQ ?? phoneQRef.current;
    const nextMonth = opts.month ?? monthRef.current;
    const nextDevice = opts.device ?? deviceRef.current;
    const nextSort = "setupSort" in opts ? (opts.setupSort ?? null) : setupSortRef.current;
    const includeDevices = opts.includeDevices ?? false;
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
          device: nextDevice,
          phoneQ: nextPhone,
          filters: nextFilters,
          includeDevices,
          setupSort: nextSort,
        }),
        { cache: "no-store" },
      );
      const data = await readJson(res);
      if (seq !== refreshSeq.current) return;
      if (monthRef.current !== nextMonth || deviceRef.current !== nextDevice) return;
      if (!res.ok || !data) {
        if (!background) setListError("Не удалось загрузить звонки");
        return;
      }
      setPage(data.page);
      setTotal(data.total);
      if (replace) setMonths(data.months);
      if (data.devices !== null) setDevices(data.devices);
      if (data.device !== deviceRef.current) {
        deviceRef.current = data.device;
        setDevice(data.device);
      }
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
        else if (baselineEmptyRef.current) params.set("baseline", "empty");
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
          baselineEmpty: sinceRef.current == null && baselineEmptyRef.current,
        });
        if (cancelled) return;
        sinceRef.current = decision.since;
        if (decision.since) baselineEmptyRef.current = false;
        if (status) {
          setPoisonFiles(status.poisonFiles);
          setLoadAge({
            lastPassAt: status.lastPassAt,
            hadCalls: status.hadCalls,
            lastCheckedAt: status.lastCheckedAt,
          });
        }
        if (decision.reload) {
          void loadListRef.current({
            page: 1,
            replace: true,
            background: true,
            includeDevices: true,
          });
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

  async function onExport() {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const res = await fetch("/api/smg/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layout: exportLayout,
          month,
          device,
          phoneQ: phoneQ.trim(),
          filters,
          setupSort,
        }),
      });
      const started = (await res.json()) as {
        error?: string;
        job?: { id: string; status: string; error: string | null };
      };
      if (!res.ok || !started.job) {
        toast.error(started.error?.trim() || "Не удалось начать выгрузку");
        return;
      }
      const id = started.job.id;
      for (;;) {
        const statusRes = await fetch(`/api/smg/export/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const body = (await statusRes.json()) as {
          error?: string;
          job?: { status: string; error: string | null };
        };
        if (!statusRes.ok || !body.job) {
          toast.error(body.error?.trim() || "Не удалось скачать файл");
          return;
        }
        if (body.job.status === "error") {
          toast.error(body.job.error?.trim() || "Не удалось сформировать XLSX");
          return;
        }
        if (body.job.status === "ready") break;
        await new Promise((resolve) => {
          window.setTimeout(resolve, 700);
        });
      }
      const link = document.createElement("a");
      link.href = `/api/smg/export/${encodeURIComponent(id)}/download`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      toast.error("Не удалось скачать файл");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

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
  const gatewayOptions =
    devices.length > 0
      ? devices.map((item) => ({
          value: item.sign,
          label: `${item.sign} (${formatCount(item.count)})`,
        }))
      : [{ value: "", label: "Нет шлюзов" }];
  const facetSet = facetColumns ? new Set<string>(facetColumns) : null;
  const showsFacet = (column: string) => {
    if (column === "deviceSign") return false;
    if (facetSet) return facetSet.has(column);
    return isSmgField(column);
  };
  const poisonSummary = showOps ? null : formatSmgPoisonSummary(poisonFiles);

  function openTrace(row: SmgListItem) {
    const token = traceRequest.current + 1;
    traceRequest.current = token;
    setTraceRow(row);
    setTraceLoading(true);
    setTraceError(null);
    setTrace(null);
    void fetch(`/api/smg/calls/${encodeURIComponent(row.id)}/trace`)
      .then(async (response) => {
        const body = (await response.json()) as TraceLookup & { error?: string };
        if (!response.ok) throw new Error(body.error || "Не удалось прочитать трассу");
        return body;
      })
      .then((body) => {
        if (traceRequest.current === token) setTrace(body);
      })
      .catch((cause: unknown) => {
        if (traceRequest.current !== token) return;
        setTraceError(cause instanceof Error ? cause.message : "Не удалось прочитать трассу");
      })
      .finally(() => {
        if (traceRequest.current === token) setTraceLoading(false);
      });
  }

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
          {loadAge ? (
            <LoadAgeChip
              lastPassAt={loadAge.lastPassAt}
              hadCalls={loadAge.hadCalls}
              lastCheckedAt={loadAge.lastCheckedAt}
              colored
            />
          ) : null}
          <Button type="button" onClick={() => void onExport()} disabled={exporting}>
            {exporting ? "Сохранение…" : "Сохранить данные"}
          </Button>
          {showOps && canRetry ? (
            <Button type="button" onClick={() => void onRetry()} disabled={pending}>
              {pending ? "Импорт…" : "Повторить импорт"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <PhoneSearchInput
          id={searchInputId}
          value={phoneInput}
          onChange={setPhoneInput}
        />
        <div className="flex flex-wrap items-center gap-2">
          <FitSelect
            id="smg-gateway"
            aria-label="Шлюз"
            textClassName={FILTER_TOOLBAR_TEXT}
            value={devices.length > 0 ? device : ""}
            options={gatewayOptions}
            disabled={devices.length === 0}
            onChange={(next) => {
              if (!next || next === deviceRef.current) return;
              deviceRef.current = next;
              setDevice(next);
              setFilters({});
              setSetupSort(null);
              setupSortRef.current = null;
              setOpenColumn(null);
              void loadList({
                page: 1,
                replace: true,
                device: next,
                filters: {},
                setupSort: null,
              });
            }}
          />
          <FitSelect
            id="smg-month"
            aria-label="Месяц"
            textClassName={FILTER_TOOLBAR_TEXT}
            value={month}
            options={monthOptions}
            onChange={(nextKey) => {
              if (!parseMonthKey(nextKey) || nextKey === monthRef.current) return;
              monthRef.current = nextKey;
              setMonth(nextKey);
              void loadList({
                page: 1,
                replace: true,
                month: nextKey,
                includeDevices: true,
              });
            }}
          />
        </div>
      </div>

      {hasActiveFilters(filters) || phoneQ ? (
        <ActiveFiltersBar
          filters={filters}
          headers={headerLabels}
          formatValue={formatSmgFacet}
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

      {showOps && poisonFiles.length > 0 ? (
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

      {poisonSummary ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive shrink-0 rounded-md border px-3 py-2 text-sm"
        >
          {poisonSummary}
        </div>
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
              {columns.map((field) => (
                <TableHead key={field} className="font-medium">
                  <div className="flex items-center gap-0.5">
                    {showsFacet(field) ? (
                      <ColumnFilterDropdown
                        column={field}
                        header={headerLabels[field] ?? field}
                        open={openColumn === field}
                        selected={filters[field] ?? []}
                        filters={filters}
                        buildFacetsUrl={({ column, filters: nextFilters, q }) => {
                          const params = new URLSearchParams();
                          params.set("column", column);
                          params.set("month", month);
                          if (device) params.set("device", device);
                          if (phoneQ.trim()) params.set("phoneQ", phoneQ.trim());
                          if (q.trim()) params.set("q", q.trim());
                          const encoded = encodeFilters(nextFilters);
                          if (encoded) params.set("filters", encoded);
                          return `/api/smg/facets?${params.toString()}`;
                        }}
                        formatValue={(value) => formatSmgFacet(field, value)}
                        onToggle={() => setOpenColumn(openColumn === field ? null : field)}
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
                    ) : (
                      (headerLabels[field] ?? field)
                    )}
                    {field === "setupDay" ? (
                      <DateSortButton
                        sort={setupSort}
                        onChange={(next) => {
                          setSetupSort(next);
                          setupSortRef.current = next;
                          void loadList({ page: 1, replace: true, setupSort: next });
                        }}
                      />
                    ) : null}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground h-24"
                >
                  Загрузка…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground h-24"
                >
                  {hasActiveFilters(filters) || phoneQ
                    ? "Нет данных по текущим фильтрам. Сбросьте фильтры или уточните выбор."
                    : "Нет данных."}
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={traceRow?.id === row.id ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => openTrace(row)}
                >
                  {columns.map((field) => {
                    const text = smgSummaryCellText(field, row);
                    const className = BOLD_PHONE_FIELDS.has(field)
                      ? "font-medium tabular-nums"
                      : PHONE_FIELDS.has(field) || TABULAR_COLUMNS.has(field)
                        ? "tabular-nums"
                        : undefined;
                    return (
                      <TableCell key={field} className={className}>
                        {highlightPhones && PHONE_FIELDS.has(field) ? (
                          <HighlightText text={text} query={phoneQ} />
                        ) : (
                          text
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableInfiniteBody>
      <TableCountFooter shown={items.length} total={total} />
      <SmgCallTraceSheet
        row={traceRow}
        loading={traceLoading}
        error={traceError}
        trace={trace}
        onOpenChange={(open) => {
          if (!open) {
            traceRequest.current += 1;
            setTraceRow(null);
          }
        }}
      />
    </div>
  );
}

function DateSortButton({
  sort,
  onChange,
}: {
  sort: TimeSort | null;
  onChange: (next: TimeSort | null) => void;
}) {
  const active = sort != null;
  const label =
    sort === "desc"
      ? "Дата и время начала, по убыванию. Нажмите для возрастания"
      : sort === "asc"
        ? "Дата и время начала, по возрастанию. Нажмите чтобы сбросить"
        : "Сортировать по дате и времени начала";
  return (
    <div className={`col-header col-header-sort${active ? " active" : ""}`}>
      <button
        type="button"
        className="col-filter-trigger"
        aria-label={label}
        aria-pressed={active}
        onClick={() => onChange(nextTimeSort(sort))}
      >
        <span className="col-filter-chevron" aria-hidden>
          {timeSortChevron(sort)}
        </span>
      </button>
    </div>
  );
}
