"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  decideFacetLoad,
  facetReloadKey,
  type FacetFullList,
  type FacetScope,
} from "@/components/column-filters/facet-reload";
import {
  displayFacetValue,
  EMPTY_FILTER_TOKEN,
  formatFacetCount,
  toFilterToken,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";

type Props = {
  column: string;
  header: string;
  open: boolean;
  selected: string[];
  filters: ColumnFilters;
  /** Build facets URL for current open column (includes kind etc.) */
  buildFacetsUrl: (opts: { column: string; filters: ColumnFilters; q: string }) => string;
  /**
   * When the server returned every group, further typing uses this match
   * instead of another request. Omitted menus always ask the server.
   */
  matchFacet?: (value: string, q: string) => boolean;
  /** Optional display override (e.g. status labels, timestamps) */
  formatValue?: (value: string) => string;
  onToggle: () => void;
  onChange: (values: string[]) => void;
  onClear: () => void;
};

type Panel = { column: string; body: FacetResponse };

type Cache = {
  loaded: FacetScope;
  full: FacetFullList | null;
  panel: Panel;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function facetRequestKey(job: FacetScope): string {
  return `${job.column}\n${job.q}\n${job.scopeKey}\n${JSON.stringify(job.filters)}`;
}

export function ColumnFilterDropdown(props: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, header, selected, onToggle, onClear } = props;
  const active = selected.length > 0;

  return (
    <div className={`col-header col-header-filter${active ? "active" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="col-filter-trigger"
        onClick={onToggle}
      >
        <span className="col-header-label">{header}</span>
        {active ? <span className="col-filter-count">{selected.length}</span> : null}
        <span className="col-filter-chevron" aria-hidden>
          ▾
        </span>
        {active && (
          <span
            className="col-filter-clear"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onClear();
              }
            }}
          >
            ×
          </span>
        )}
      </button>
      {open ? <OpenColumnFilter {...props} triggerRef={triggerRef} /> : null}
    </div>
  );
}

function OpenColumnFilter({
  column,
  header,
  selected,
  filters,
  buildFacetsUrl,
  matchFacet,
  formatValue,
  onToggle,
  onChange,
  onClear,
  triggerRef,
}: Props & { triggerRef: RefObject<HTMLButtonElement | null> }) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buildFacetsUrlRef = useRef(buildFacetsUrl);
  const matchRef = useRef(matchFacet);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [cache, setCache] = useState<Cache | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const scopeKey = facetReloadKey(buildFacetsUrl({ column, filters: {}, q: "" }));
  const job: FacetScope = { column, q, scopeKey, filters };
  const requestKey = facetRequestKey(job);
  const decision = decideFacetLoad({
    next: job,
    loaded: cache?.loaded ?? null,
    full: cache?.full ?? null,
    match: matchFacet,
  });
  const shown: FacetResponse | null =
    decision.kind === "local"
      ? { items: decision.items, truncated: false }
      : cache?.panel.column === column
        ? cache.panel.body
        : null;
  const error = failure?.key === requestKey ? failure.message : null;
  const loading = decision.kind === "fetch" && shown == null && error == null;

  useEffect(() => {
    buildFacetsUrlRef.current = buildFacetsUrl;
    matchRef.current = matchFacet;
  }, [buildFacetsUrl, matchFacet]);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 200);
    return () => clearTimeout(t);
  }, [qInput]);

  useLayoutEffect(() => {
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = {
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 260),
      };
      setPos((prev) =>
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width
          ? prev
          : next,
      );
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [triggerRef]);

  useEffect(() => {
    const next: FacetScope = { column, q, scopeKey, filters };
    const current = decideFacetLoad({
      next,
      loaded: cache?.loaded ?? null,
      full: cache?.full ?? null,
      match: matchRef.current,
    });
    if (current.kind !== "fetch") return;

    const ac = new AbortController();
    let cancelled = false;
    const run = async () => {
      try {
        const url = buildFacetsUrlRef.current({ column, filters, q });
        const res = await fetch(url, {
          method: "GET",
          cache: "no-store",
          signal: ac.signal,
        });
        if (cancelled) return;
        if (res.status === 499) {
          setFailure({ key: requestKey, message: "Отменено" });
          return;
        }
        const body = (await res.json().catch(() => null)) as
          FacetResponse | { error?: string } | null;
        if (cancelled) return;
        if (!res.ok) {
          const msg =
            body && typeof body === "object" && "error" in body && body.error
              ? String(body.error)
              : "Ошибка загрузки";
          throw new Error(msg);
        }
        const payload = body as FacetResponse;
        const loaded: FacetScope = { column, q, scopeKey, filters };
        setCache((prev) => ({
          loaded,
          full: !q.trim()
            ? payload.truncated
              ? null
              : { ...loaded, items: payload.items }
            : (prev?.full ?? null),
          panel: { column, body: payload },
        }));
        setFailure(null);
      } catch (caught) {
        if (cancelled || isAbortError(caught)) return;
        setFailure({
          key: requestKey,
          message: caught instanceof Error ? caught.message : "Ошибка загрузки",
        });
      }
    };
    void run();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [cache, column, filters, q, requestKey, scopeKey]);

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      onToggle();
    };
    // Defer so the opening click does not immediately close the menu.
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onToggle, triggerRef]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const active = selected.length > 0;
  const showValue = formatValue ?? displayFacetValue;

  const toggleValue = (rawValue: string) => {
    const token = toFilterToken(rawValue === "" ? "" : rawValue);
    if (selectedSet.has(token)) {
      onChange(selected.filter((v) => v !== token));
    } else {
      onChange([...selected, token]);
    }
  };

  if (!pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={dropdownRef}
      className="col-filter-dropdown"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
        position: "fixed",
      }}
    >
      <input
        className="col-filter-search"
        placeholder={`Поиск ${header}…`}
        value={qInput}
        onChange={(e) => setQInput(e.target.value)}
        autoFocus
      />
      <div className="col-filter-list">
        {loading && <div className="col-filter-state">Загрузка…</div>}
        {error && <div className="col-filter-state error">{error}</div>}
        {!loading && !error && shown?.items.length === 0 && (
          <div className="col-filter-state">Нет значений</div>
        )}
        {shown?.items.map((item) => {
          const token = toFilterToken(
            item.value === EMPTY_FILTER_TOKEN ? "" : item.value,
          );
          const checked = selectedSet.has(token);
          return (
            <label key={token} className="col-filter-option">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleValue(token)}
              />
              <span className="col-filter-option-label">{showValue(token)}</span>
              <span className="col-filter-option-count">
                ({formatFacetCount(item.count)})
              </span>
            </label>
          );
        })}
        {shown?.truncated && (
          <div className="col-filter-state">
            Показаны первые значения — уточните поиск
          </div>
        )}
      </div>
      {active && (
        <button type="button" className="col-filter-clear-btn" onClick={onClear}>
          Очистить «{header}»
        </button>
      )}
    </div>,
    document.body,
  );
}
