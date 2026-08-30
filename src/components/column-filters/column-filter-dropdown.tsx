"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ColumnFilters,
  FacetResponse,
} from "@/components/column-filters/types";
import {
  displayFacetValue,
  facetFiltersAffectQuery,
  formatFacetCount,
  toFilterToken,
} from "@/components/column-filters/types";

type Props = {
  column: string;
  header: string;
  open: boolean;
  selected: string[];
  filters: ColumnFilters;
  /** Build facets URL for current open column (includes kind etc.) */
  buildFacetsUrl: (opts: {
    column: string;
    filters: ColumnFilters;
    q: string;
  }) => string;
  /** Optional display override (e.g. status labels, timestamps) */
  formatValue?: (value: string) => string;
  onToggle: () => void;
  onChange: (values: string[]) => void;
  onClear: () => void;
};

export function ColumnFilterDropdown({
  column,
  header,
  open,
  selected,
  filters,
  buildFacetsUrl,
  formatValue,
  onToggle,
  onChange,
  onClear,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FacetResponse | null>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const buildFacetsUrlRef = useRef(buildFacetsUrl);
  buildFacetsUrlRef.current = buildFacetsUrl;
  const dataRef = useRef(data);
  dataRef.current = data;
  const errorRef = useRef(error);
  errorRef.current = error;
  const wasOpenRef = useRef(false);
  const loadedRef = useRef<{
    column: string;
    q: string;
    scopeUrl: string;
    filters: ColumnFilters;
  } | null>(null);
  const scopeUrl = buildFacetsUrl({ column, filters: {}, q });

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 200);
    return () => clearTimeout(t);
  }, [qInput]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 260),
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setQInput("");
      setQ("");
      return;
    }
    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;
    const prev = loadedRef.current;
    const haveData = dataRef.current != null && errorRef.current == null;
    if (
      !justOpened &&
      haveData &&
      prev &&
      prev.column === column &&
      prev.q === q &&
      prev.scopeUrl === scopeUrl &&
      !facetFiltersAffectQuery(column, prev.filters, filters)
    ) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = buildFacetsUrlRef.current({ column, filters, q });
        const res = await fetch(url, { method: "GET", cache: "no-store" });
        const body = (await res.json().catch(() => null)) as
          | FacetResponse
          | { error?: string }
          | null;
        if (!res.ok) {
          const msg =
            body && typeof body === "object" && "error" in body && body.error
              ? String(body.error)
              : "Ошибка загрузки";
          throw new Error(msg);
        }
        if (!cancelled) {
          setData(body as FacetResponse);
          loadedRef.current = { column, q, scopeUrl, filters };
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка загрузки");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, column, filters, q, scopeUrl]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, onToggle]);

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

  const dropdown =
    open &&
    pos &&
    typeof document !== "undefined" &&
    createPortal(
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
          {!loading && !error && data?.items.length === 0 && (
            <div className="col-filter-state">Нет значений</div>
          )}
          {!loading &&
            !error &&
            data?.items.map((item) => {
              const token = toFilterToken(
                item.value === "__empty__" ? "" : item.value,
              );
              const checked = selectedSet.has(token);
              return (
                <label
                  key={`${token}:${item.count}`}
                  className="col-filter-option"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleValue(token)}
                  />
                  <span className="col-filter-option-label">
                    {showValue(token)}
                  </span>
                  <span className="col-filter-option-count">
                    ({formatFacetCount(item.count)})
                  </span>
                </label>
              );
            })}
          {data?.truncated && (
            <div className="col-filter-state">
              Показаны первые значения — уточните поиск
            </div>
          )}
        </div>
        {active && (
          <button
            type="button"
            className="col-filter-clear-btn"
            onClick={onClear}
          >
            Очистить «{header}»
          </button>
        )}
      </div>,
      document.body,
    );

  return (
    <div className={`col-header col-header-filter${active ? " active" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="col-filter-trigger"
        onClick={onToggle}
      >
        <span className="col-header-label">{header}</span>
        {active ? (
          <span className="col-filter-count">{selected.length}</span>
        ) : null}
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
      {dropdown}
    </div>
  );
}
