"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FitSelect } from "@/components/fit-select";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadXlsxFromUrl } from "@/lib/download-xlsx";
import { formatBytes } from "@/modules/storage/format-bytes";
import type {
  SyslogCascade,
  SyslogChoice,
  SyslogFileRow,
  SyslogPurgeMonth,
  SyslogSelected,
} from "@/modules/smg-syslog/browse";
import { formatLastPacket } from "@/modules/smg-syslog/format-last-packet";

type Device = { ip: string; name: string };

type Query = {
  year?: string;
  month?: string;
  day?: string;
  hour?: string;
};

type Payload = {
  devices: Device[];
  cascade: SyslogCascade | null;
  purgeMonths: SyslogPurgeMonth[];
  lastPacket: string | null;
  storedBytes: number | null;
  status: { lowSpace: boolean } | null;
};

function monthKey(month: SyslogPurgeMonth): string {
  return `${month.year}-${month.month}`;
}

function queryKey(query: Query): string {
  return [query.year, query.month, query.day, query.hour].filter(Boolean).join("/");
}

function selectedKey(selected: SyslogSelected | null): string {
  if (!selected) return "";
  return `${selected.year}/${selected.month}/${selected.day}/${selected.hour}`;
}

export function SyslogView({
  initialDevices,
  canPurge,
}: {
  initialDevices: Device[];
  canPurge: boolean;
}) {
  const [devices, setDevices] = useState(initialDevices);
  const [device, setDevice] = useState(initialDevices[0]?.ip ?? "");
  const [query, setQuery] = useState<Query>({});
  const [cascade, setCascade] = useState<SyslogCascade | null>(null);
  const [purgeMonths, setPurgeMonths] = useState<SyslogPurgeMonth[]>([]);
  const [cutoff, setCutoff] = useState("");
  const [lastPacket, setLastPacket] = useState<string | null>(null);
  const [storedBytes, setStoredBytes] = useState<number | null>(null);
  const [lowSpace, setLowSpace] = useState(false);
  const [purging, setPurging] = useState(false);
  const generation = useRef(0);
  const scrollRef = useRef(true);

  const load = useCallback(async (gen: number, nextDevice: string, nextQuery: Query) => {
    if (!nextDevice) {
      setCascade(null);
      setPurgeMonths([]);
      setLastPacket(null);
      setStoredBytes(null);
      return;
    }
    const params = new URLSearchParams({ device: nextDevice });
    if (nextQuery.year) params.set("year", nextQuery.year);
    if (nextQuery.month) params.set("month", nextQuery.month);
    if (nextQuery.day) params.set("day", nextQuery.day);
    if (nextQuery.hour) params.set("hour", nextQuery.hour);
    const res = await fetch(`/api/smg/syslog?${params.toString()}`, {
      cache: "no-store",
    });
    if (gen !== generation.current) return;
    if (!res.ok) return;
    const body = (await res.json()) as Payload;
    if (gen !== generation.current) return;
    setDevices(body.devices);
    setCascade(body.cascade);
    setPurgeMonths(body.purgeMonths);
    setLastPacket(body.lastPacket);
    setStoredBytes(body.storedBytes ?? null);
    setLowSpace(Boolean(body.status?.lowSpace));
    const nextSelected = selectedKey(body.cascade?.selected ?? null);
    const asked = queryKey(nextQuery);
    if (body.cascade?.selected && asked !== nextSelected) {
      scrollRef.current = true;
      setQuery(body.cascade.selected);
    }
    if (body.devices.length > 0 && !body.devices.some((row) => row.ip === nextDevice)) {
      scrollRef.current = true;
      setQuery({});
      setStoredBytes(null);
      setDevice(body.devices[0]?.ip ?? "");
    }
  }, []);

  useEffect(() => {
    const gen = ++generation.current;
    const timer = window.setTimeout(() => {
      void load(gen, device, query);
    }, 0);
    const poll = window.setInterval(() => {
      void load(generation.current, device, query);
    }, 4000);
    return () => {
      generation.current += 1;
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [device, query, load]);

  useEffect(() => {
    if (!scrollRef.current) return;
    const node = document.querySelector("[data-syslog-focus='true']");
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
    scrollRef.current = false;
  }, [cascade]);

  function choose(next: Query) {
    scrollRef.current = true;
    setQuery(next);
  }

  async function download(slot: string) {
    const selected = cascade?.selected;
    if (!selected) return;
    const params = new URLSearchParams({
      device,
      year: selected.year,
      month: selected.month,
      day: selected.day,
      hour: selected.hour,
      slot,
    });
    const result = await downloadXlsxFromUrl(
      `/api/smg/syslog/file?${params.toString()}`,
      `${slot}.log`,
    );
    if (!result.ok) toast.error(result.message);
  }

  async function purge() {
    const active = purgeMonths.some((month) => monthKey(month) === cutoff)
      ? cutoff
      : purgeMonths[0]
        ? monthKey(purgeMonths[0])
        : "";
    const boundary = purgeMonths.find((month) => monthKey(month) === active);
    const doomed = purgeMonths.filter((month) => monthKey(month) < active);
    if (!boundary || doomed.length === 0 || purging) return;
    const current = devices.find((row) => row.ip === device);
    const name = current ? `${current.name} (${current.ip})` : device;
    const newest = doomed[0]?.label ?? boundary.label;
    const confirmed = window.confirm(
      `Удалить файлы узла ${name} до ${boundary.label}? Будет удалено месяцев: ${doomed.length}. Самый новый из удаляемых: ${newest}. ${boundary.label} и более новые данные останутся. Это нельзя отменить.`,
    );
    if (!confirmed) return;
    setPurging(true);
    try {
      const res = await fetch("/api/smg/syslog/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device, year: boundary.year, month: boundary.month }),
      });
      const body = (await res.json()) as { error?: string; deleted?: string[] };
      if (!res.ok) {
        toast.error(body.error ?? "Не удалось удалить файлы");
        return;
      }
      const count = body.deleted?.length ?? 0;
      toast.success(
        count > 0 ? `Удалено месяцев: ${count}` : "Файлов старше выбранного месяца нет",
      );
      scrollRef.current = true;
      setQuery({});
    } finally {
      setPurging(false);
    }
  }

  const selected = cascade?.selected ?? null;
  const years = cascade?.years ?? [];
  const months = cascade?.months ?? [];
  const days = cascade?.days ?? [];
  const hours = cascade?.hours ?? [];
  const files = cascade?.files ?? [];
  const cutoffValue = purgeMonths.some((month) => monthKey(month) === cutoff)
    ? cutoff
    : purgeMonths[0]
      ? monthKey(purgeMonths[0])
      : "";
  const rowCount = Math.max(
    years.length,
    months.length,
    days.length,
    hours.length,
    files.length,
  );
  const focusRow = selected
    ? Math.max(
        years.findIndex((row) => row.name === selected.year),
        months.findIndex((row) => row.name === selected.month),
        days.findIndex((row) => row.name === selected.day),
        hours.findIndex((row) => row.name === selected.hour),
      )
    : -1;
  const packetLabel = lastPacket ? (formatLastPacket(lastPacket) ?? lastPacket) : "нет";
  const visibleDoomed = purgeMonths.filter((month) => monthKey(month) < cutoffValue);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <h1 className="text-xl font-semibold tracking-tight">Syslog</h1>
      <div className="flex flex-wrap items-center gap-2">
        <FitSelect
          id="syslog-device"
          aria-label="Узел SMG"
          textClassName={FILTER_TOOLBAR_TEXT}
          value={device}
          disabled={devices.length === 0}
          options={
            devices.length > 0
              ? devices.map((row) => ({
                  value: row.ip,
                  label: `${row.name} (${row.ip})`,
                }))
              : [{ value: "", label: "Нет узлов" }]
          }
          onChange={(value) => {
            scrollRef.current = true;
            setQuery({});
            setStoredBytes(null);
            setDevice(value);
          }}
        />
      </div>
      {lowSpace ? (
        <p className="text-destructive text-sm">
          На томе Syslog меньше 1 ГБ свободно. Запись продолжается.
        </p>
      ) : null}
      <p className="text-sm">
        Последние данные (UTC): <span className="font-semibold">{packetLabel}</span>
      </p>
      {device ? (
        <p className="text-sm">
          Объем данных Syslog по узлу:{" "}
          <span className="font-semibold">
            {storedBytes == null ? "…" : formatBytes(storedBytes)}
          </span>
        </p>
      ) : null}
      {devices.length === 0 ? (
        <p className="text-muted-foreground text-sm">Добавьте узел SMG в Настройках.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Год</TableHead>
                <TableHead>Месяц</TableHead>
                <TableHead>День</TableHead>
                <TableHead>Час</TableHead>
                <TableHead>Мин</TableHead>
                <TableHead>Объем</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Скачать</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: rowCount }, (_, index) => {
                const file = files[index];
                return (
                  <TableRow
                    key={index}
                    className="hover:bg-transparent"
                    data-syslog-focus={index === focusRow ? "true" : undefined}
                  >
                    <ChoiceCell
                      choice={years[index]}
                      selected={years[index]?.name === selected?.year}
                      onSelect={
                        years[index]
                          ? () => choose({ year: years[index]?.name })
                          : undefined
                      }
                    />
                    <ChoiceCell
                      choice={months[index]}
                      selected={months[index]?.name === selected?.month}
                      onSelect={
                        months[index] && selected
                          ? () =>
                              choose({ year: selected.year, month: months[index]?.name })
                          : undefined
                      }
                    />
                    <ChoiceCell
                      choice={days[index]}
                      selected={days[index]?.name === selected?.day}
                      onSelect={
                        days[index] && selected
                          ? () =>
                              choose({
                                year: selected.year,
                                month: selected.month,
                                day: days[index]?.name,
                              })
                          : undefined
                      }
                    />
                    <ChoiceCell
                      choice={hours[index]}
                      selected={hours[index]?.name === selected?.hour}
                      onSelect={
                        hours[index] && selected
                          ? () =>
                              choose({
                                year: selected.year,
                                month: selected.month,
                                day: selected.day,
                                hour: hours[index]?.name,
                              })
                          : undefined
                      }
                    />
                    <TableCell>{file?.label ?? ""}</TableCell>
                    <TableCell>{file ? formatBytes(file.bytes) : ""}</TableCell>
                    <TableCell>{file ? stateLabel(file) : ""}</TableCell>
                    <TableCell>
                      {file ? (
                        <button
                          type="button"
                          className="text-foreground bg-transparent p-0 font-semibold"
                          onClick={() => void download(file.slot)}
                        >
                          Скачать
                        </button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {canPurge && devices.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
          <span>Удаление данных до</span>
          <FitSelect
            id="syslog-purge-month"
            aria-label="Удаление данных до"
            textClassName={FILTER_TOOLBAR_TEXT}
            value={purgeMonths.length === 0 ? "" : cutoffValue}
            disabled={purgeMonths.length === 0 || purging}
            options={
              purgeMonths.length > 0
                ? purgeMonths.map((month) => ({
                    value: monthKey(month),
                    label: month.label,
                  }))
                : [{ value: "", label: "Нет полных месяцев" }]
            }
            onChange={setCutoff}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={purging || visibleDoomed.length === 0}
            onClick={() => void purge()}
          >
            удалить
          </Button>
          <span className="text-muted-foreground">Выбранный месяц не удаляется.</span>
        </div>
      ) : null}
    </div>
  );
}

function ChoiceCell({
  choice,
  selected,
  onSelect,
}: {
  choice: SyslogChoice | undefined;
  selected: boolean;
  onSelect?: () => void;
}) {
  if (!choice) return <TableCell />;
  return (
    <TableCell className={selected ? "bg-black text-white" : undefined}>
      {onSelect ? (
        <button
          type="button"
          className="block w-full bg-transparent text-left text-inherit"
          aria-pressed={selected}
          onClick={onSelect}
        >
          {choice.label}
        </button>
      ) : (
        choice.label
      )}
    </TableCell>
  );
}

function stateLabel(file: SyslogFileRow): string {
  if (file.state === "archive") return "архив";
  if (file.state === "updating") return "дописывается к архиву";
  return "пишется";
}
