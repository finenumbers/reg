"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FitSelect } from "@/components/fit-select";
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
import {
  PHONES_REGS_UNREGISTERED_POLL_MS,
  useRegsUnregisteredCount,
} from "@/hooks/use-regs-unregistered-count";
import { formatCount, formatUnregisteredOnlyLabel } from "@/lib/format-count";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import {
  convertPhonesRtuImport,
  downloadPhonesExport,
  downloadPhonesUfwExport,
  fetchPhonesList,
  fetchPhonesStatus,
} from "@/modules/phones/api-client";
import type { ListPhonesResult } from "@/modules/phones/service";
import type { PhoneKind } from "@/modules/phones/types";
import { PhonesTable } from "@/modules/phones/ui/phones-table";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { useStampRefresh } from "@/hooks/stamp-watch";
import { formatSyncLine, type SyncSnapshot } from "@/modules/jobs/sync-line";

const PAGE_SIZE = TABLE_PAGE_SIZE;
const PHONE_SEARCH_DEBOUNCE_MS = 300;

type Props = {
  initial: ListPhonesResult;
  initialSync: SyncSnapshot;
  /** Live SIP Unregistered from reg_current (Registrations), not catalog «Нет». */
  initialRegsUnregisteredCount: number;
};

function phonesSyncLine(
  sync: SyncSnapshot,
  timeZone: string,
  registeredCount: number,
  unregisteredCount: number,
): string {
  const line = formatSyncLine(sync, timeZone);
  if (!sync.finishedAt) return line;
  return `${line} · с рег. ${formatCount(registeredCount)}, без рег. ${formatCount(unregisteredCount)}`;
}

function selectKind(next: PhoneKind, current: PhoneKind, load: (k: PhoneKind) => void) {
  if (next === current) return;
  load(next);
}

export function PhonesView({
  initial,
  initialSync,
  initialRegsUnregisteredCount,
}: Props) {
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
  const [registeredCount, setRegisteredCount] = useState(initial.registeredCount);
  const [unregisteredCount, setUnregisteredCount] = useState(initial.unregisteredCount);
  const [regsUnregisteredCount, setRegsUnregisteredCount] = useState(
    initialRegsUnregisteredCount,
  );
  const [errorCount, setErrorCount] = useState(initial.errorCount);
  const [sync, setSync] = useState(initialSync);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [rtuConverting, setRtuConverting] = useState(false);
  const [ufwExporting, setUfwExporting] = useState(false);
  const [rtuError, setRtuError] = useState<{
    error: string;
    details: string[];
  } | null>(null);
  const rtuFileInputRef = useRef<HTMLInputElement | null>(null);
  const refreshSeq = useRef(0);
  const loadingMoreRef = useRef(false);
  const filtersRef = useRef(filters);
  const phoneQRef = useRef(phoneQ);
  const sipUnregisteredOnlyRef = useRef(sipUnregisteredOnly);
  const kindRef = useRef(kind);
  const pageRef = useRef(page);
  const itemsLenRef = useRef(items.length);
  const openColumnRef = useRef(openColumn);
  const loadingRef = useRef(loading);
  const phoneSearchTimerRef = useRef<number | null>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  filtersRef.current = filters;
  phoneQRef.current = phoneQ;
  sipUnregisteredOnlyRef.current = sipUnregisteredOnly;
  kindRef.current = kind;
  pageRef.current = page;
  itemsLenRef.current = items.length;
  openColumnRef.current = openColumn;
  loadingRef.current = loading;

  const hasMore = items.length < total;
  const filtersActive =
    hasActiveFilters(filters) || phoneQ.trim().length > 0 || sipUnregisteredOnly;

  const headerLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const h of headers) map[h] = h;
    return map;
  }, [headers]);

  const kindOptions = useMemo(() => {
    const options: { value: PhoneKind; label: string }[] = [
      { value: "gateways", label: "Шлюзы" },
      { value: "endpoints_registered", label: "Транки с регистрацией" },
      { value: "endpoints_unregistered", label: "Транки без регистрации" },
    ];
    if (errorCount > 0 || kind === "endpoints_error") {
      options.push({
        value: "endpoints_error",
        label: `Ошибка (${formatCount(errorCount)})`,
      });
    }
    return options;
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
      if (phoneSearchTimerRef.current != null) {
        window.clearTimeout(phoneSearchTimerRef.current);
        phoneSearchTimerRef.current = null;
      }
      setPhoneInput(phoneQRef.current);
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
    soft?: boolean;
  }) {
    const replace = opts.replace ?? true;
    const nextKind = opts.kind ?? kindRef.current;
    const nextFilters = opts.filters ?? filtersRef.current;
    const nextPhoneQ = opts.phoneQ !== undefined ? opts.phoneQ : phoneQRef.current;
    const nextSipOnly =
      opts.sipUnregisteredOnly !== undefined
        ? opts.sipUnregisteredOnly
        : sipUnregisteredOnlyRef.current;
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

    const result = await fetchPhonesList({
      kind: nextKind,
      filters: nextFilters,
      phoneQ: nextPhoneQ,
      sipUnregisteredOnly: nextKind === "endpoints_registered" ? nextSipOnly : false,
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
    setRegisteredCount(result.data.registeredCount);
    setUnregisteredCount(result.data.unregisteredCount);
    setErrorCount(result.data.errorCount);
    setItems((prev) => (replace ? result.data.items : [...prev, ...result.data.items]));
    setLoading(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }

  const loadListRef = useRef(loadList);
  loadListRef.current = loadList;

  const catalogPaused = () =>
    openColumnRef.current != null ||
    loadingRef.current ||
    loadingMoreRef.current ||
    pageRef.current > 1 ||
    itemsLenRef.current > PAGE_SIZE;

  useRegsUnregisteredCount({
    intervalMs: PHONES_REGS_UNREGISTERED_POLL_MS,
    paused: catalogPaused,
    onCount: setRegsUnregisteredCount,
    onSnapshot: () => {
      if (kindRef.current !== "endpoints_registered") return;
      void loadListRef.current({ page: 1, replace: true, soft: true });
    },
  });

  useStampRefresh({
    intervalMs: PHONES_REGS_UNREGISTERED_POLL_MS,
    initialStamp: initial.lastSyncedAt,
    paused: catalogPaused,
    pull: async () => {
      const status = await fetchPhonesStatus();
      if (!status.ok) return { ok: false };
      setSync(status.data.sync);
      return { ok: true, stamp: status.data.lastSyncedAt };
    },
    onReload: () => {
      void loadListRef.current({ page: 1, replace: true, soft: true });
    },
  });

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

  function applyFilters(next: ColumnFilters, opts: { closeDropdown?: boolean } = {}) {
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
    if (result.noticeCount != null && result.noticeCount > 0) {
      toast.success(
        `Файл для импорта в UFW скачан. Номеров с регистрацией не «Да» и не «Нет»: ${formatCount(result.noticeCount)} — в файл не вошли`,
      );
      return;
    }
    toast.success("Файл для импорта в UFW скачан");
  }

  function switchKind(next: PhoneKind) {
    selectKind(next, kind, (k) => {
      if (phoneSearchTimerRef.current != null) {
        window.clearTimeout(phoneSearchTimerRef.current);
        phoneSearchTimerRef.current = null;
      }
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
          <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
            Телефонные номера
          </h1>
          <p className="text-muted-foreground text-sm">
            {phonesSyncLine(sync, timeZone, registeredCount, unregisteredCount)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            className={EXPORT_XLSX_BUTTON_CLASS}
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
        </div>
      </div>

      {rtuError ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive flex min-h-0 shrink-0 flex-col rounded-md border px-3 py-2 text-sm"
        >
          <p className="shrink-0 font-medium">{rtuError.error}</p>
          <ul className="mt-1 max-h-[min(40vh,20rem)] list-disc space-y-0.5 overflow-y-auto pl-5">
            {rtuError.details.map((d, i) => (
              <li key={`${i}-${d.slice(0, 48)}`}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <PhoneSearchInput
            id="phones-phone-search"
            value={phoneInput}
            onChange={onPhoneInputChange}
          />
          {kind === "endpoints_registered" ? (
            <div className="flex items-center gap-2">
              <input
                id="phones-sip-unregistered-only"
                type="checkbox"
                className="size-4 rounded border"
                checked={sipUnregisteredOnly}
                onChange={(e) => onSipUnregisteredOnlyChange(e.target.checked)}
              />
              <Label htmlFor="phones-sip-unregistered-only">
                <RowColorMark tone="unregistered">
                  {formatUnregisteredOnlyLabel(regsUnregisteredCount)}
                </RowColorMark>
              </Label>
            </div>
          ) : null}
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
        <FitSelect
          id="phones-kind"
          value={kind}
          options={kindOptions}
          onChange={(value) => switchKind(value as PhoneKind)}
          aria-label="Раздел"
          textClassName={FILTER_TOOLBAR_TEXT}
        />
      </div>

      <ActiveFiltersBar
        filters={filters}
        headers={headerLabels}
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
          <PhonesTable
            kind={kind}
            headers={headers}
            data={items}
            loading={loading && items.length === 0}
            emptyMessage={
              filtersActive
                ? "Нет данных по текущим фильтрам. Сбросьте фильтры или уточните выбор."
                : "Нет данных. Включите регулярную загрузку телефонных номеров и входящих групп в Настройках."
            }
            filters={filters}
            phoneQ={phoneQ}
            sipUnregisteredOnly={kind === "endpoints_registered" && sipUnregisteredOnly}
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
