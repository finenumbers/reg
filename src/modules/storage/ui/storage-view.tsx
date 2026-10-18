"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  fetchStorageSnapshot,
  postStoragePurge,
  postStorageVacuum,
} from "@/modules/storage/api-client";
import { formatByteParts, formatBytes } from "@/modules/storage/format-bytes";
import type { StorageMonthRow, StorageSnapshot } from "@/modules/storage/service";
import { formatMonthNominative } from "@/modules/traffic/month-labels";
import { PURGE_INTERRUPT_NOTE, purgeStageLine } from "@/modules/traffic/purge/progress";
import { DATABASE_VACUUM_CONFIRM } from "@/modules/storage/vacuum/sql";
import { vacuumStageLine } from "@/modules/storage/vacuum/progress";

const POLL_MS = 3000;
const CELL_PAD_PX = 16;
const CELL_BORDER_PX = 1;
const GUESS_CH_PX = 8;

const METRIC_FIELDS = [
  "cdrCalls",
  "cdrSeconds",
  "cdrMinutes",
  "smgCalls",
  "smgSeconds",
  "smgMinutes",
] as const;

const METRIC_HEADS = ["Звонки", "Секунды", "Минуты"] as const;

type ColumnWidths = {
  month: number;
  data: number;
  delete: number;
};

function monthLabel(row: StorageMonthRow): string {
  const name = formatMonthNominative(row.year, row.month);
  return row.incomplete ? `${name} (неполный)` : name;
}

function paddedWidth(textPx: number, border: boolean): number {
  return textPx + CELL_PAD_PX + (border ? CELL_BORDER_PX : 0);
}

function guessWidth(text: string, border: boolean): number {
  return paddedWidth(Math.ceil(Math.max(text.length, 1) * GUESS_CH_PX), border);
}

function maxMetric(months: readonly StorageMonthRow[]): number {
  return months.reduce((max, row) => {
    return METRIC_FIELDS.reduce((inner, field) => Math.max(inner, row[field]), max);
  }, 0);
}

function maxSyslog(months: readonly StorageMonthRow[]): number {
  return months.reduce((max, row) => Math.max(max, row.syslogBytes), 0);
}

function guessColumns(months: readonly StorageMonthRow[]): ColumnWidths {
  const longest = months.reduce((best, row) => {
    const label = monthLabel(row);
    return label.length > best.length ? label : best;
  }, "");
  const hasDelete = months.some((row) => row.canDelete);
  const deleteGuess = hasDelete
    ? paddedWidth(Math.ceil("Удалить".length * GUESS_CH_PX) + 20, false)
    : guessWidth("Удаление", false);
  const data = Math.max(
    guessWidth(formatCount(maxMetric(months)), true),
    guessWidth(formatBytes(maxSyslog(months)), true),
  );
  return {
    month: guessWidth(longest || "0", true),
    data,
    delete: deleteGuess,
  };
}

function SummaryMetric({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="grid grid-cols-[1fr_auto] gap-x-1">
      <span className="text-right">{value}</span>
      <span>{unit}</span>
    </span>
  );
}

function StorageFigures({
  data,
  onDelete,
}: {
  data: StorageSnapshot;
  onDelete: (row: StorageMonthRow) => void;
}) {
  const months = data.months;
  const hasDelete = months.some((row) => row.canDelete);
  const metricText = formatCount(maxMetric(months));
  const syslogText = formatBytes(maxSyslog(months));
  const measureKey = `${months.map((row) => monthLabel(row)).join("\n")}\n${metricText}\n${syslogText}\n${hasDelete ? "1" : "0"}`;
  const guessed = useMemo(() => guessColumns(months), [months]);
  const [measured, setMeasured] = useState<{ key: string; widths: ColumnWidths } | null>(
    null,
  );
  const monthRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const metricRef = useRef<HTMLSpanElement>(null);
  const syslogRef = useRef<HTMLSpanElement>(null);
  const deleteRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const monthPx = monthRefs.current
      .slice(0, months.length)
      .reduce((max, el) => Math.max(max, el?.offsetWidth ?? 0), 0);
    const dataPx = Math.max(
      metricRef.current?.offsetWidth ?? 0,
      syslogRef.current?.offsetWidth ?? 0,
    );
    const deletePx = deleteRef.current?.offsetWidth ?? 0;
    setMeasured({
      key: measureKey,
      widths: {
        month: monthPx > 0 ? paddedWidth(monthPx, true) : guessed.month,
        data: dataPx > 0 ? paddedWidth(dataPx, true) : guessed.data,
        delete: deletePx > 0 ? paddedWidth(deletePx, false) : guessed.delete,
      },
    });
  }, [guessed, measureKey, months.length]);

  const widths = measured?.key === measureKey ? measured.widths : guessed;
  const tableWidth = widths.month + widths.data * 7 + widths.delete;
  const cdrBytes = formatByteParts(data.cdrTableBytes);
  const smgBytes = formatByteParts(data.smgTableBytes);

  return (
    <>
      <div className="relative h-0 overflow-hidden" aria-hidden>
        {months.map((row, index) => (
          <span
            key={row.key}
            ref={(el) => {
              monthRefs.current[index] = el;
            }}
            className="absolute top-0 left-0 text-xs whitespace-nowrap"
          >
            {monthLabel(row)}
          </span>
        ))}
        <span
          ref={metricRef}
          className="absolute top-0 left-0 text-xs whitespace-nowrap tabular-nums"
        >
          {metricText}
        </span>
        <span
          ref={syslogRef}
          className="absolute top-0 left-0 text-xs whitespace-nowrap tabular-nums"
        >
          {syslogText}
        </span>
        <span
          ref={deleteRef}
          className={
            hasDelete
              ? cn(
                  buttonVariants({ variant: "destructive", size: "sm" }),
                  "absolute top-0 left-0",
                )
              : "absolute top-0 left-0 text-xs font-medium whitespace-nowrap"
          }
        >
          {hasDelete ? "Удалить" : "Удаление"}
        </span>
      </div>

      <div className="overflow-auto">
        <div className="grid w-max grid-cols-[auto_auto_auto_auto_auto_auto] items-baseline gap-x-6 text-sm whitespace-nowrap tabular-nums">
          <span>CDR:</span>
          <SummaryMetric value={formatCount(data.totalCdrCalls)} unit="звонков" />
          <SummaryMetric value={formatCount(data.totalCdrSeconds)} unit="сек" />
          <SummaryMetric value={formatCount(data.totalCdrMinutes)} unit="мин" />
          <span className="text-right">таблицы:</span>
          <SummaryMetric value={cdrBytes.value} unit={cdrBytes.unit} />
          <span>SMG:</span>
          <SummaryMetric value={formatCount(data.totalSmgCalls)} unit="звонков" />
          <SummaryMetric value={formatCount(data.totalSmgSeconds)} unit="сек" />
          <SummaryMetric value={formatCount(data.totalSmgMinutes)} unit="мин" />
          <span className="text-right">таблицы:</span>
          <SummaryMetric value={smgBytes.value} unit={smgBytes.unit} />
        </div>
        <p className="mt-2 text-sm tabular-nums">
          Syslog:{" "}
          <span className="font-semibold">{formatBytes(data.totalSyslogBytes)}</span>
        </p>
      </div>

      <div className="overflow-auto">
        <Table className="table-fixed" style={{ width: tableWidth }}>
          <colgroup>
            <col style={{ width: widths.month }} />
            {METRIC_FIELDS.map((field) => (
              <col key={field} style={{ width: widths.data }} />
            ))}
            <col style={{ width: widths.data }} />
            <col style={{ width: widths.delete }} />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="h-auto text-center align-middle">
                Месяц
              </TableHead>
              <TableHead colSpan={3} className="text-center">
                Звонки Satel RTU
              </TableHead>
              <TableHead colSpan={3} className="text-center">
                Звонки Eltex SMG-1016M
              </TableHead>
              <TableHead
                rowSpan={2}
                className="h-auto text-center align-middle shadow-[inset_-1px_-1px_0_0_var(--border)]!"
              >
                Syslog
              </TableHead>
              <TableHead
                rowSpan={2}
                className="h-auto overflow-hidden text-center align-middle"
              >
                Удаление
              </TableHead>
            </TableRow>
            <TableRow>
              {(["cdr", "smg"] as const).flatMap((side) =>
                METRIC_HEADS.map((label) => (
                  <TableHead
                    key={`${side}-${label}`}
                    className={cn(
                      "top-7 text-center",
                      side === "smg" &&
                        label === "Минуты" &&
                        "shadow-[inset_-1px_-1px_0_0_var(--border)]!",
                    )}
                  >
                    {label}
                  </TableHead>
                )),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{monthLabel(row)}</TableCell>
                {METRIC_FIELDS.map((field) => (
                  <TableCell key={field} className="text-right tabular-nums">
                    {formatCount(row[field])}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">
                  {formatBytes(row.syslogBytes)}
                </TableCell>
                <TableCell className="text-right">
                  {row.canDelete ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => onDelete(row)}
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
    </>
  );
}

export function StorageView() {
  const [data, setData] = useState<StorageSnapshot | null>(null);
  const [confirm, setConfirm] = useState<StorageMonthRow | null>(null);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [vacuumOpen, setVacuumOpen] = useState(false);
  const [vacuumTyped, setVacuumTyped] = useState("");
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
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!data?.purgeInFlight && !data?.importInFlight && !data?.vacuumInFlight) return;
    const timer = window.setInterval(() => {
      void reload();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [data?.purgeInFlight, data?.importInFlight, data?.vacuumInFlight, reload]);

  async function onConfirmVacuum() {
    if (vacuumTyped.trim() !== DATABASE_VACUUM_CONFIRM) return;
    setPending(true);
    const result = await postStorageVacuum(DATABASE_VACUUM_CONFIRM);
    setPending(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Сжатие базы запущено");
    setVacuumOpen(false);
    setVacuumTyped("");
    await reload();
  }

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
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Хранение данных</h2>
        <p className="text-muted-foreground text-sm">
          Месяцы CDR (колонка «Дата»), звонков SMG (день разъединения) и архивов Syslog.
          Одно удаление снимает звонки обоих источников, карточки АнтиФрода этих звонков
          SMG, архивы Syslog, задачи и записи аудита этого месяца UTC. Удалить можно
          только самый старый полный месяц, по одному. Текущий месяц трогать нельзя. Место
          на диске после удаления возвращает кнопка «Сжать базу», когда она закончится.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </div>
      ) : null}

      {!data && !error ? (
        <p className="text-muted-foreground text-sm">Загрузка…</p>
      ) : null}

      {data?.purgeInFlight && data.purge ? (
        <div
          role="status"
          className="border-border bg-muted/40 rounded-md border px-3 py-2 text-sm"
        >
          {data.purge.mode === "legacy" ? (
            <p>
              Удаляется {data.purge.month}… {formatCount(data.purge.deleted)}
              {data.purge.target > 0 ? ` / ${formatCount(data.purge.target)}` : ""}.{" "}
              {PURGE_INTERRUPT_NOTE}
            </p>
          ) : (
            <div className="space-y-1">
              <p>Удаляется {data.purge.month}</p>
              <ol className="list-decimal space-y-0.5 pl-5">
                {data.purge.stages.map((stage) => (
                  <li key={stage.id}>{purgeStageLine(stage)}</li>
                ))}
              </ol>
              <p>{PURGE_INTERRUPT_NOTE}</p>
            </div>
          )}
        </div>
      ) : null}

      <div>
        <Button
          type="button"
          variant="outline"
          disabled={
            !data ||
            data.purgeInFlight ||
            data.importInFlight ||
            data.vacuumInFlight ||
            pending
          }
          onClick={() => {
            setVacuumOpen(true);
            setVacuumTyped("");
          }}
        >
          Сжать базу
        </Button>
      </div>

      {data?.vacuumInFlight && data.vacuum ? (
        <div
          role="status"
          className="border-border bg-muted/40 rounded-md border px-3 py-2 text-sm"
        >
          <div className="space-y-1">
            <p>Сжимается база</p>
            <ol className="list-decimal space-y-0.5 pl-5">
              {data.vacuum.stages.map((stage) => (
                <li key={stage.id}>{vacuumStageLine(stage)}</li>
              ))}
            </ol>
            <p>{data.vacuum.note}</p>
          </div>
        </div>
      ) : null}

      {data?.vacuumFailure && !data.vacuumInFlight ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          <div className="space-y-1">
            <p>{data.vacuumFailure.message}</p>
            <ol className="list-decimal space-y-0.5 pl-5">
              {data.vacuumFailure.stages.map((stage) => (
                <li key={stage.id}>{vacuumStageLine(stage)}</li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}

      {data?.importInFlight && !data.purgeInFlight && !data.vacuumInFlight ? (
        <div
          role="status"
          className="border-border bg-muted/40 rounded-md border px-3 py-2 text-sm"
        >
          {data.cdrImportInFlight && data.smgImportInFlight
            ? "Идёт импорт CDR и SMG."
            : data.smgImportInFlight
              ? "Идёт импорт CDR SMG."
              : "Идёт импорт CDR."}{" "}
          Удаление месяца будет доступно после окончания загрузки.
        </div>
      ) : null}

      {data && !data.monthsHidden ? (
        <StorageFigures
          data={data}
          onDelete={(row) => {
            setConfirm(row);
            setTyped("");
          }}
        />
      ) : null}

      {confirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="storage-purge-title"
        >
          <div className="bg-background w-full max-w-md space-y-4 rounded-lg border p-4 shadow-lg">
            <div>
              <h2 id="storage-purge-title" className="text-base font-semibold">
                Удалить {monthLabel(confirm)}?
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                Будут безвозвратно удалены {formatCount(confirm.cdrCalls)} звонков CDR (
                {formatCount(confirm.cdrSeconds)} сек, {formatCount(confirm.cdrMinutes)}{" "}
                мин), связанные ссылки VoIPmonitor, {formatCount(confirm.smgCalls)}{" "}
                звонков SMG ({formatCount(confirm.smgSeconds)} сек,{" "}
                {formatCount(confirm.smgMinutes)} мин), карточки АнтиФрода этих звонков
                SMG, архивы Syslog ({formatBytes(confirm.syslogBytes)}), а также задачи и
                записи аудита за этот месяц UTC. Введите ключ месяца{" "}
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

      {vacuumOpen && data ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="storage-vacuum-title"
        >
          <div className="bg-background w-full max-w-md space-y-4 rounded-lg border p-4 shadow-lg">
            <div>
              <h2 id="storage-vacuum-title" className="text-base font-semibold">
                Сжать базу?
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                Живые звонки останутся. Уже удалённый месяц в копию не входит. Пока идёт
                сжатие, страницы трафика, статистики и детализации отвечают отказом и не
                ждут. Новые файлы CDR и SMG остаются в очереди и загружаются после
                окончания. На томе базы нужно свободно не меньше{" "}
                {formatBytes(data.tableBytes * 2)} — это удвоенный размер таблиц CDR,
                ссылок VoIPmonitor и звонков SMG, новая копия и её журнал. Перезапуск
                обрывает текущую таблицу и не стирает живые строки. Введите{" "}
                <span className="font-mono">{DATABASE_VACUUM_CONFIRM}</span>.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vacuum-confirm">Подтверждение</Label>
              <Input
                id="vacuum-confirm"
                value={vacuumTyped}
                onChange={(e) => setVacuumTyped(e.target.value)}
                autoComplete="off"
                aria-invalid={
                  vacuumTyped.length > 0 && vacuumTyped.trim() !== DATABASE_VACUUM_CONFIRM
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setVacuumOpen(false);
                  setVacuumTyped("");
                }}
                disabled={pending}
              >
                Отмена
              </Button>
              <Button
                type="button"
                disabled={pending || vacuumTyped.trim() !== DATABASE_VACUUM_CONFIRM}
                onClick={() => void onConfirmVacuum()}
              >
                {pending ? "Запуск…" : "Сжать"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
