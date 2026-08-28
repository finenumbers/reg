"use client";

import { useRef, useState } from "react";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { formatDisplayTimestamp } from "@/lib/format-display-time";
import { toast } from "sonner";
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
  fetchGroupsList,
  fetchGroupsStatus,
  postGroupsRequest,
  toGroupsSyncStatusSnapshot,
} from "@/modules/groups/api-client";
import type { ListRoutingGroupsResult } from "@/modules/groups/service";
import {
  IDLE_SYNC_STATE,
  isSyncInFlight,
  reduceSyncUiState,
  waitForPhonesSyncOutcome,
  type SyncUiState,
} from "@/modules/phones/request-action";

type Props = {
  canRequest: boolean;
  initial: ListRoutingGroupsResult;
};

function formatSyncedAt(iso: string | null, timeZone: string): string {
  if (!iso) return "ещё не загружалось";
  return formatDisplayTimestamp(iso, timeZone);
}

export function GroupsView({ canRequest, initial }: Props) {
  const { timeZone } = useDisplayTimezone();
  const [items, setItems] = useState(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [lastSyncedAt, setLastSyncedAt] = useState(initial.lastSyncedAt);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncState, setSyncState] = useState<SyncUiState>(IDLE_SYNC_STATE);
  const syncInFlightRef = useRef(false);

  async function reloadList() {
    setLoading(true);
    setListError(null);
    const result = await fetchGroupsList();
    setLoading(false);
    if (!result.ok) {
      setListError(result.message);
      return;
    }
    setItems(result.data.items);
    setTotal(result.data.total);
    setLastSyncedAt(result.data.lastSyncedAt);
  }

  async function onRequest() {
    if (!canRequest || syncInFlightRef.current || isSyncInFlight(syncState)) {
      return;
    }
    syncInFlightRef.current = true;
    setSyncState(reduceSyncUiState(syncState, { type: "START" }));

    try {
      const before = await fetchGroupsStatus();
      const beforeFinishedAt = before.ok ? before.data.lastFinishedAt : null;

      const enqueued = await postGroupsRequest();
      if (!enqueued.ok) {
        const next = reduceSyncUiState(IDLE_SYNC_STATE, {
          type: "ERROR",
          message: enqueued.message,
          conflict: enqueued.conflict,
        });
        setSyncState(next);
        toast.error(enqueued.message);
        return;
      }

      const outcome = await waitForPhonesSyncOutcome({
        beforeFinishedAt,
        fetchStatus: async () => {
          const status = await fetchGroupsStatus();
          if (!status.ok) {
            throw new Error(status.message);
          }
          return toGroupsSyncStatusSnapshot(status.data);
        },
      });

      if (outcome.ok) {
        setSyncState(
          reduceSyncUiState(IDLE_SYNC_STATE, {
            type: "SUCCESS",
            message: outcome.message,
          }),
        );
        toast.success(outcome.message);
        await reloadList();
      } else {
        setSyncState(
          reduceSyncUiState(IDLE_SYNC_STATE, {
            type: "ERROR",
            message: outcome.message,
          }),
        );
        toast.error(outcome.message);
      }
    } catch {
      const message = "Не удалось выполнить запрос";
      setSyncState(
        reduceSyncUiState(IDLE_SYNC_STATE, { type: "ERROR", message }),
      );
      toast.error(message);
    } finally {
      syncInFlightRef.current = false;
    }
  }

  const pending = isSyncInFlight(syncState);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Входящие группы
          </h1>
          <p className="text-sm text-muted-foreground">
            Последняя загрузка: {formatSyncedAt(lastSyncedAt, timeZone)}. Всего: {total}.
          </p>
        </div>
        {canRequest ? (
          <Button
            type="button"
            onClick={() => void onRequest()}
            disabled={pending || loading}
          >
            {pending ? "Загрузка…" : "Загрузить данные"}
          </Button>
        ) : null}
      </div>

      {syncState.message ? (
        <p
          className={
            syncState.status === "success"
              ? "shrink-0 text-sm text-emerald-700"
              : "shrink-0 text-sm text-destructive"
          }
        >
          {syncState.message}
        </p>
      ) : null}

      {listError ? (
        <p className="shrink-0 text-sm text-destructive" role="alert">
          {listError}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Название</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-muted-foreground">
                    {loading
                      ? "Загрузка…"
                      : "Нет данных. Нажмите «Загрузить данные», чтобы загрузить с softswitch."}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono tabular-nums">
                      {row.externalId}
                    </TableCell>
                    <TableCell>{row.name}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
