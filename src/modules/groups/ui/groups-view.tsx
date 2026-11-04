"use client";

import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { formatCount } from "@/lib/format-count";
import { formatDisplayTimestamp } from "@/lib/format-display-time";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ListRoutingGroupsResult } from "@/modules/groups/service";

type Props = {
  initial: ListRoutingGroupsResult;
};

function formatSyncedAt(iso: string | null, timeZone: string): string {
  if (!iso) return "ещё не загружалось";
  return formatDisplayTimestamp(iso, timeZone);
}

export function GroupsView({ initial }: Props) {
  const { timeZone } = useDisplayTimezone();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Входящие группы
        </h1>
        <p className="text-muted-foreground text-sm">
          Последняя загрузка: {formatSyncedAt(initial.lastSyncedAt, timeZone)}. Всего:{" "}
          {formatCount(initial.total)}.
        </p>
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
              {initial.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-muted-foreground">
                    Нет данных. Включите регулярную загрузку телефонных номеров и входящих
                    групп в Настройках.
                  </TableCell>
                </TableRow>
              ) : (
                initial.items.map((row) => (
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
