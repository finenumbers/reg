"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount } from "@/lib/format-count";
import {
  fetchStorageSnapshot,
  postStoragePurge,
} from "@/modules/storage/api-client";
import type { StorageMonthRow, StorageSnapshot } from "@/modules/storage/service";
import { formatMonthNominative } from "@/modules/traffic/month-labels";

const POLL_MS = 3000;

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const digits = value >= 10 || i === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[i]}`;
}

function monthLabel(row: StorageMonthRow): string {
  const name = formatMonthNominative(row.year, row.month);
  return row.incomplete ? `${name} (неполный)` : name;
}

type Props = { initial: StorageSnapshot };

export function StorageView({ initial }: Props) {
  const [data, setData] = useState(initial);
  const [confirm, setConfirm] = useState<StorageMonthRow | null>(null);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await fetchStorageSnapshot();
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setData(result.data);
  }, []);

  useEffect(() => {
    if (!data.purgeInFlight && !data.importInFlight) return;
    const timer = window.setInterval(() => {
      void reload();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [data.purgeInFlight, data.importInFlight, reload]);

  async function onConfirmDelete() {
    if (!confirm) return;
    if (typed.trim() !== confirm.key) return;
    setPending(true);
    const result = await postStoragePurge(confirm.key);
    setPending(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Удаление ${monthLabel(confirm)} запущено`);
    setConfirm(null);
    setTyped("");
    await reload();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Хранение данных
        </h1>
        <p className="text-sm text-muted-foreground">
          Месяцы CDR в локальной базе (по колонке «Дата»). Удалить можно только
          самый старый полный месяц, по одному. Текущий месяц трогать нельзя.
          Место на диске вернётся после очистки базы (autovacuum), не сразу.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {data.purgeInFlight && data.purge ? (
        <div
          role="status"
          className="shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
        >
          Удаляется {data.purge.month}… {formatCount(data.purge.deleted)}
          {data.purge.target > 0
            ? ` / ${formatCount(data.purge.target)}`
            : ""}
          . Если прервётся — запустите ещё раз.
        </div>
      ) : null}

      {data.importInFlight && !data.purgeInFlight ? (
        <div
          role="status"
          className="shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
        >
          Идёт импорт CDR. Удаление месяца будет доступно после окончания
          загрузки.
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Всего {formatCount(data.totalCalls)} звонков ·{" "}
        {formatCount(data.totalMinutes)} мин · таблицы CDR{" "}
        {formatBytes(data.tableBytes)}
      </p>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Месяц</TableHead>
              <TableHead className="text-right">Кол-во звонков</TableHead>
              <TableHead className="text-right">Кол-во минут</TableHead>
              <TableHead className="text-right">Удаление</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.months.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{monthLabel(row)}</TableCell>
                <TableCell className="text-right">
                  {formatCount(row.calls)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCount(row.minutes)}
                </TableCell>
                <TableCell className="text-right">
                  {row.canDelete ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setConfirm(row);
                        setTyped("");
                      }}
                    >
                      Удалить
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {confirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="storage-purge-title"
        >
          <div className="w-full max-w-md space-y-4 rounded-lg border bg-background p-4 shadow-lg">
            <div>
              <h2 id="storage-purge-title" className="text-base font-semibold">
                Удалить {monthLabel(confirm)}?
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Будут безвозвратно удалены {formatCount(confirm.calls)} звонков (
                {formatCount(confirm.minutes)} мин) и связанные ссылки
                VoIPmonitor. Введите ключ месяца{" "}
                <span className="font-mono">{confirm.key}</span>.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purge-confirm">Месяц YYYY-MM</Label>
              <Input
                id="purge-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                aria-invalid={typed.length > 0 && typed.trim() !== confirm.key}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConfirm(null);
                  setTyped("");
                }}
                disabled={pending}
              >
                Отмена
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending || typed.trim() !== confirm.key}
                onClick={() => void onConfirmDelete()}
              >
                {pending ? "Запуск…" : "Удалить"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
