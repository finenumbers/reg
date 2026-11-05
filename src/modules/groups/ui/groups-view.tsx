"use client";

import { useRef, useState } from "react";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { formatCount } from "@/lib/format-count";
import { useStampRefresh } from "@/hooks/stamp-watch";
import { formatSyncLine, type SyncSnapshot } from "@/modules/jobs/sync-line";
import { fetchGroups, fetchGroupsStatus } from "@/modules/groups/api-client";
import type { ListRoutingGroupsResult } from "@/modules/groups/service";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const GROUPS_STATUS_POLL_MS = 15_000;

type Props = {
  initial: ListRoutingGroupsResult;
  initialSync: SyncSnapshot;
};

export function GroupsView({ initial, initialSync }: Props) {
  const { timeZone } = useDisplayTimezone();
  const [items, setItems] = useState(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [sync, setSync] = useState(initialSync);
  const loadingRef = useRef(false);

  useStampRefresh({
    intervalMs: GROUPS_STATUS_POLL_MS,
    initialStamp: initial.lastSyncedAt,
    paused: () => loadingRef.current,
    pull: async () => {
      const status = await fetchGroupsStatus();
      if (!status.ok) return { ok: false };
      setSync(status.data.sync);
      return { ok: true, stamp: status.data.lastSyncedAt };
    },
    onReload: () => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      void fetchGroups()
        .then((list) => {
          if (!list.ok) return;
          setItems(list.data.items);
          setTotal(list.data.total);
        })
        .finally(() => {
          loadingRef.current = false;
        });
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Входящие группы
        </h1>
        <p className="text-muted-foreground text-sm">{formatSyncLine(sync, timeZone)}</p>
      </div>

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
                    Нет данных. Включите регулярную загрузку телефонных номеров и входящих
                    групп в Настройках.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono tabular-nums">{row.externalId}</TableCell>
                    <TableCell>{row.name}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground shrink-0 pt-2 text-sm">Всего: {formatCount(total)}</p>
      </div>
    </div>
  );
}
