"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TableCountFooter,
  TableInfiniteBody,
} from "@/components/table-infinite-body";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { fetchAuditList } from "@/modules/audit/api-client";
import type {
  AuditLogListItem,
  ListAuditLogsResult,
} from "@/modules/audit/query";
import {
  auditMetaHasDetails,
  formatAuditAction,
  formatAuditActor,
  formatAuditTarget,
  formatAuditTimestamp,
  summarizeAuditMeta,
} from "@/modules/audit/ui-format";

const PAGE_SIZE = TABLE_PAGE_SIZE;
const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  initial: ListAuditLogsResult;
};

export function AuditView({ initial }: Props) {
  const [actionInput, setActionInput] = useState("");
  const [actorInput, setActorInput] = useState("");
  const [actionQuery, setActionQuery] = useState("");
  const [actorQuery, setActorQuery] = useState("");
  const [page, setPage] = useState(initial.page);
  const [items, setItems] = useState(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const refreshSeq = useRef(0);
  const actionTimer = useRef<number | null>(null);
  const actorTimer = useRef<number | null>(null);
  const loadingMoreRef = useRef(false);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  const hasMore = items.length < total;

  useEffect(() => {
    return () => {
      if (actionTimer.current != null) window.clearTimeout(actionTimer.current);
      if (actorTimer.current != null) window.clearTimeout(actorTimer.current);
      refreshSeq.current += 1;
    };
  }, []);

  async function loadList(
    opts: {
      action?: string;
      actor?: string;
      page?: number;
      replace?: boolean;
    } = {},
  ) {
    const replace = opts.replace ?? true;
    const nextAction = opts.action ?? actionQuery;
    const nextActor = opts.actor ?? actorQuery;
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

    const result = await fetchAuditList({
      action: nextAction || undefined,
      actor: nextActor || undefined,
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

    setTotal(result.data.total);
    setPage(result.data.page);
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
  }, [hasMore, loading, page, actionQuery, actorQuery]);

  const sentinelRef = useInfiniteScroll({
    enabled: hasMore && !loading && !loadingMore && !listError,
    onLoadMore,
    root: scrollRoot,
  });

  function onActionInput(value: string) {
    setActionInput(value);
    if (actionTimer.current != null) window.clearTimeout(actionTimer.current);
    actionTimer.current = window.setTimeout(() => {
      const next = value.trim();
      setActionQuery(next);
      void loadList({ action: next, page: 1, replace: true });
    }, SEARCH_DEBOUNCE_MS);
  }

  function onActorInput(value: string) {
    setActorInput(value);
    if (actorTimer.current != null) window.clearTimeout(actorTimer.current);
    actorTimer.current = window.setTimeout(() => {
      const next = value.trim();
      setActorQuery(next);
      void loadList({ actor: next, page: 1, replace: true });
    }, SEARCH_DEBOUNCE_MS);
  }

  function toggleExpand(item: AuditLogListItem) {
    if (!auditMetaHasDetails(item.meta)) return;
    setExpandedId((cur) => (cur === item.id ? null : item.id));
  }

  const emptyMessage =
    actionQuery || actorQuery
      ? "Нет событий аудита по текущим фильтрам."
      : "Событий аудита пока нет.";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Аудит</h1>
        <p className="text-sm text-muted-foreground">
          События безопасности и действия операторов. Секреты в meta никогда не
          показываются.
        </p>
      </div>

      {listError ? (
        <div
          role="alert"
          className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {listError}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-3"
            onClick={() => void loadList({ page: 1, replace: true })}
          >
            Повторить
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-end gap-3">
          <Input
            id="audit-action-filter"
            value={actionInput}
            onChange={(e) => onActionInput(e.target.value)}
            placeholder="Действие"
            aria-label="Действие"
            className="w-48"
            autoComplete="off"
          />
          <Input
            id="audit-actor-filter"
            value={actorInput}
            onChange={(e) => onActorInput(e.target.value)}
            placeholder="Инициатор"
            aria-label="Инициатор"
            className="w-44"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadList({ page: 1, replace: true })}
            disabled={loading}
          >
            Обновить
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TableInfiniteBody
            scrollRef={setScrollRoot}
            sentinelRef={sentinelRef}
            loadingMore={loadingMore}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Время</TableHead>
                  <TableHead>Инициатор</TableHead>
                  <TableHead>Действие</TableHead>
                  <TableHead>Цель</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Детали</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Загрузка…
                    </TableCell>
                  </TableRow>
                ) : null}
                {!loading && items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      {emptyMessage}
                    </TableCell>
                  </TableRow>
                ) : null}
                {items.map((item) => {
                  const open = expandedId === item.id;
                  const expandable = auditMetaHasDetails(item.meta);
                  return (
                    <Fragment key={item.id}>
                      <TableRow
                        className={expandable ? "cursor-pointer" : undefined}
                        onClick={() => toggleExpand(item)}
                        data-state={open ? "selected" : undefined}
                      >
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatAuditTimestamp(item.createdAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatAuditActor(item)}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-medium">
                            {formatAuditAction(item.action)}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {item.action}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate text-xs">
                          {formatAuditTarget(item)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.ip ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                          {summarizeAuditMeta(item.meta)}
                        </TableCell>
                      </TableRow>
                      {open && item.meta ? (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/40 text-sm">
                            <p className="mb-2 text-xs text-muted-foreground">
                              Санитизированная meta (секреты скрыты)
                            </p>
                            <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background p-3 text-xs whitespace-pre-wrap break-words">
                              {JSON.stringify(item.meta, null, 2)}
                            </pre>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableInfiniteBody>
          <TableCountFooter shown={items.length} total={total} />
        </div>
      </div>
    </div>
  );
}

