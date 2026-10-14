"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FitSelect } from "@/components/fit-select";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { Button } from "@/components/ui/button";
import { downloadXlsxFromUrl } from "@/lib/download-xlsx";
import { formatBytes } from "@/modules/storage/format-bytes";
import type { SyslogFileRow, SyslogFolder, SyslogList } from "@/modules/smg-syslog/browse";

type Device = { ip: string; name: string };

type Crumb = {
  year?: string;
  month?: string;
  day?: string;
  hour?: string;
};

type Payload = {
  devices: Device[];
  list: SyslogList | null;
  status: { lowSpace: boolean; listening: boolean } | null;
};

export function SyslogView({ initialDevices }: { initialDevices: Device[] }) {
  const [devices, setDevices] = useState(initialDevices);
  const [device, setDevice] = useState(initialDevices[0]?.ip ?? "");
  const [crumb, setCrumb] = useState<Crumb>({});
  const [list, setList] = useState<SyslogList | null>(null);
  const [lowSpace, setLowSpace] = useState(false);

  const load = useCallback(async (nextDevice: string, nextCrumb: Crumb) => {
    if (!nextDevice) {
      setList(null);
      return;
    }
    const params = new URLSearchParams({ device: nextDevice });
    if (nextCrumb.year) params.set("year", nextCrumb.year);
    if (nextCrumb.month) params.set("month", nextCrumb.month);
    if (nextCrumb.day) params.set("day", nextCrumb.day);
    if (nextCrumb.hour) params.set("hour", nextCrumb.hour);
    const res = await fetch(`/api/smg/syslog?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as Payload;
    setDevices(body.devices);
    setList(body.list);
    setLowSpace(Boolean(body.status?.lowSpace));
    if (body.devices.length > 0 && !body.devices.some((row) => row.ip === nextDevice)) {
      setDevice(body.devices[0]?.ip ?? "");
      setCrumb({});
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(device, crumb);
    }, 0);
    const poll = window.setInterval(() => {
      void load(device, crumb);
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [device, crumb, load]);

  async function download(slot: string) {
    if (!crumb.year || !crumb.month || !crumb.day || !crumb.hour) return;
    const params = new URLSearchParams({
      device,
      year: crumb.year,
      month: crumb.month,
      day: crumb.day,
      hour: crumb.hour,
      slot,
    });
    const result = await downloadXlsxFromUrl(
      `/api/smg/syslog/file?${params.toString()}`,
      `${slot}.log`,
    );
    if (!result.ok) toast.error(result.message);
  }

  const pathLabel = [
    crumb.year,
    listLabel(list, crumb),
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Syslog</h1>
        <p className="text-sm text-muted-foreground">
          Журнал шлюзов Eltex SMG. Закрытый интервал скачивается архивом gzip.
        </p>
      </div>
      {lowSpace ? (
        <p className="text-sm text-destructive">На томе Syslog меньше 1 ГБ свободно. Запись продолжается.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <FitSelect
          id="syslog-device"
          aria-label="Узел SMG"
          textClassName={FILTER_TOOLBAR_TEXT}
          value={device}
          disabled={devices.length === 0}
          options={
            devices.length > 0
              ? devices.map((row) => ({ value: row.ip, label: `${row.name} (${row.ip})` }))
              : [{ value: "", label: "Нет узлов" }]
          }
          onChange={(value) => {
            setDevice(value);
            setCrumb({});
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button type="button" variant="outline" size="sm" onClick={() => setCrumb({})}>
          Годы
        </Button>
        {crumb.year ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCrumb({ year: crumb.year })}
          >
            {crumb.year}
          </Button>
        ) : null}
        {crumb.month ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCrumb({ year: crumb.year, month: crumb.month })}
          >
            {crumb.month}
          </Button>
        ) : null}
        {crumb.day ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCrumb({ year: crumb.year, month: crumb.month, day: crumb.day })}
          >
            {crumb.day}
          </Button>
        ) : null}
        {crumb.hour ? <span>{crumb.hour}</span> : null}
        {pathLabel ? <span className="text-muted-foreground">{pathLabel}</span> : null}
      </div>
      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">Добавьте узел SMG в Настройках.</p>
      ) : list?.kind === "folders" ? (
        <ul className="space-y-1">
          {list.folders.length === 0 ? (
            <li className="text-sm text-muted-foreground">Папка пуста.</li>
          ) : (
            list.folders.map((folder) => (
              <li key={folder.name}>
                <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => openFolder(folder)}>
                  {folder.label}
                </Button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <ul className="space-y-1">
          {(list?.files ?? []).length === 0 ? (
            <li className="text-sm text-muted-foreground">В этом часе файлов нет.</li>
          ) : (
            (list?.files ?? []).map((file) => (
              <li key={file.slot} className="flex items-center gap-3 text-sm">
                <span className="w-10 font-medium">{file.label}</span>
                <span className="text-muted-foreground">{formatBytes(file.bytes)}</span>
                <span className="text-muted-foreground">{stateLabel(file)}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void download(file.slot)}>
                  Скачать
                </Button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );

  function openFolder(folder: SyslogFolder) {
    if (!crumb.year) setCrumb({ year: folder.name });
    else if (!crumb.month) setCrumb({ year: crumb.year, month: folder.name });
    else if (!crumb.day) setCrumb({ ...crumb, day: folder.name });
    else setCrumb({ ...crumb, hour: folder.name });
  }
}

function stateLabel(file: SyslogFileRow): string {
  if (file.state === "archive") return "архив";
  if (file.state === "updating") return "дописывается к архиву";
  return "пишется";
}

function listLabel(list: SyslogList | null, crumb: Crumb): string {
  if (!list || list.kind !== "folders" || !crumb.month) return crumb.month ?? "";
  return list.folders.find((folder) => folder.name === crumb.month)?.label ?? crumb.month;
}
