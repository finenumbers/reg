"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { CDR_TIMEZONE_OPTIONS } from "@/lib/display-timezone";
import { formatLastPacket } from "@/modules/smg-syslog/format-last-packet";
import type { SyslogStatus } from "@/modules/smg-syslog/status";
import { formatBytes } from "@/modules/storage/format-bytes";

type NodeRow = {
  ip: string;
  name: string;
  identifier: string | null;
  cdrTimezone: string;
};

type Draft = { ip: string; name: string; identifier: string };

const NO_PACKET = "с запуска пакетов не было";

function FitInput({ value, ...props }: ComponentProps<typeof Input> & { value: string }) {
  return (
    <Input
      {...props}
      value={value}
      className="h-7 w-auto px-1.5 text-xs"
      style={{ width: `${Math.max(value.length, 6) + 2}ch` }}
    />
  );
}

type Payload = {
  enabled: boolean;
  advertisePort: string;
  nodes: NodeRow[];
  status: SyslogStatus | null;
};

export function SyslogSettings() {
  const [data, setData] = useState<Payload | null>(null);
  const [ip, setIp] = useState("");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [cdrTimezone, setCdrTimezone] = useState("UTC");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [leftover, setLeftover] = useState<NodeRow | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/settings/smg-syslog", { cache: "no-store" });
    if (!res.ok) return;
    const payload = (await res.json()) as Payload;
    setData(payload);
    setDraft((current) => {
      if (!current) return current;
      return payload.nodes.some((node) => node.ip === current.ip) ? current : null;
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload();
    }, 0);
    const poll = window.setInterval(() => {
      void reload();
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [reload]);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/smg-syslog", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Не удалось изменить приём");
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function addNode() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/smg-syslog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ip, name, identifier, cdrTimezone }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Не удалось добавить узел");
        return;
      }
      setIp("");
      setName("");
      setIdentifier("");
      setCdrTimezone("UTC");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function saveZone(node: NodeRow, nextZone: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/settings/smg-syslog/nodes/${encodeURIComponent(node.ip)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: node.name, cdrTimezone: nextZone }),
        },
      );
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Не удалось сохранить пояс CDR");
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  function beginRename(node: NodeRow) {
    setDraft({ ip: node.ip, name: node.name, identifier: node.identifier ?? "" });
  }

  async function saveRename() {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/settings/smg-syslog/nodes/${encodeURIComponent(draft.ip)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: draft.name, identifier: draft.identifier }),
        },
      );
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Не удалось переименовать узел");
        return;
      }
      setDraft(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(node: NodeRow) {
    if (
      !window.confirm(
        `Удалить узел ${node.name} (${node.ip})? Приём с этого адреса прекратится. Все сохранённые файлы этого узла будут удалены безвозвратно.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/settings/smg-syslog/nodes/${encodeURIComponent(node.ip)}`,
        {
          method: "DELETE",
        },
      );
      const body = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        if (body.code === "FILES_REMAIN") setLeftover(node);
        toast.error(body.error ?? "Не удалось удалить узел");
        return;
      }
      setLeftover((current) => (current?.ip === node.ip ? null : current));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function retryLeftover() {
    if (!leftover) return;
    if (
      !window.confirm(`Повторить удаление файлов узла ${leftover.name} (${leftover.ip})?`)
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/settings/smg-syslog/nodes/${encodeURIComponent(leftover.ip)}`,
        { method: "DELETE" },
      );
      const body = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Не удалось удалить файлы узла");
        if (body.code !== "FILES_REMAIN") setLeftover(null);
        return;
      }
      setLeftover(null);
      toast.success("Файлы узла удалены");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const status = data?.status;
  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold">Syslog — SMG</h2>
      <p className="text-muted-foreground text-sm">
        На шлюзе укажите UDP-порт {data?.advertisePort ?? "514"} и IP этого хоста. В
        список попадает адрес, с которого пакет приходит на сервер. Неизвестный адрес не
        сохраняется. Трассировки, история команд и журнал доступа направляются на один и
        тот же адрес.
      </p>
      <div className="flex items-center gap-2">
        <input
          id="syslog-enabled"
          type="checkbox"
          className="size-4 rounded border"
          checked={data?.enabled ?? false}
          disabled={busy || !data}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <Label htmlFor="syslog-enabled">Включить приём Syslog</Label>
        {status?.listening ? (
          <Badge variant="secondary">слушает</Badge>
        ) : (
          <Badge variant="outline">не слушает</Badge>
        )}
      </div>
      {status?.bindError ? (
        <p className="text-destructive text-sm">{status.bindError}</p>
      ) : null}
      {status?.bridgeWarning ? (
        <p className="text-destructive text-sm">
          Часть пакетов приходит с адреса моста Docker и пишется в его каталог, без
          разделения по шлюзам. На демоне Docker выключите userland-proxy и пересоздайте
          контейнер приёмника.
        </p>
      ) : null}
      {status?.recvBufferBytes != null && status.recvBufferBytes < 16 * 1024 * 1024 ? (
        <p className="text-destructive text-sm">
          Буфер приёма UDP {formatBytes(status.recvBufferBytes)} вместо 16 МБ. Поднимите
          net.core.rmem_max, иначе ядро теряет датаграммы до процесса.
        </p>
      ) : null}
      {leftover ? (
        <p className="text-destructive flex flex-wrap items-center gap-2 text-sm">
          <span>
            Узел {leftover.name} ({leftover.ip}) снят с приёма, каталог удалить не
            удалось.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void retryLeftover()}
          >
            Повторить
          </Button>
        </p>
      ) : null}
      {status?.lowSpace ? (
        <p className="text-destructive text-sm">
          На томе Syslog меньше 1 ГБ свободно
          {status.freeBytes != null ? ` (${formatBytes(status.freeBytes)})` : ""}. Запись
          продолжается, пока место не кончится.
        </p>
      ) : null}
      {status && status.unknownTotal > 0 ? (
        <p className="text-muted-foreground text-sm">
          Отброшено с неизвестных адресов: {status.unknownTotal}
          {status.unknown.length > 0
            ? `. Последние: ${status.unknown.map((row) => row.ip).join(", ")}`
            : ""}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="syslog-node-ip">IPv4 узла</Label>
          <Input
            id="syslog-node-ip"
            value={ip}
            onChange={(event) => setIp(event.target.value)}
            placeholder="10.1.2.3"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="syslog-node-name">Название</Label>
          <Input
            id="syslog-node-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Казань"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="syslog-node-identifier">Идентификатор</Label>
          <Input
            id="syslog-node-identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="kazan"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="syslog-node-zone">Пояс CDR</Label>
          <select
            id="syslog-node-zone"
            value={cdrTimezone}
            disabled={busy}
            onChange={(event) => setCdrTimezone(event.target.value)}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            {CDR_TIMEZONE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          disabled={busy || !ip.trim() || !name.trim() || !identifier.trim()}
          onClick={() => void addNode()}
        >
          Добавить
        </Button>
      </div>
      {(data?.nodes.length ?? 0) > 0 ? (
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-center">Узел Eltex SMG-1016M</TableHead>
                <TableHead className="text-center">IP адрес</TableHead>
                <TableHead className="text-center">Идентификатор</TableHead>
                <TableHead className="text-center">Пояс CDR</TableHead>
                <TableHead className="text-center">Последний пакет (UTC)</TableHead>
                <TableHead className="text-center">Переименовать</TableHead>
                <TableHead className="text-center">Удалить</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.nodes ?? []).map((node) => {
                const editing = draft?.ip === node.ip;
                const packet = status?.lastPacket[node.ip];
                const packetLabel = packet
                  ? (formatLastPacket(packet) ?? packet)
                  : NO_PACKET;
                return (
                  <TableRow key={node.ip}>
                    <TableCell>
                      {editing && draft ? (
                        <FitInput
                          value={draft.name}
                          aria-label="Название"
                          disabled={busy}
                          onChange={(event) => {
                            const next = event.target.value;
                            setDraft((current) =>
                              current ? { ...current, name: next } : current,
                            );
                          }}
                        />
                      ) : (
                        node.name
                      )}
                    </TableCell>
                    <TableCell>{node.ip}</TableCell>
                    <TableCell>
                      {editing && draft ? (
                        <FitInput
                          value={draft.identifier}
                          aria-label="Идентификатор"
                          disabled={busy}
                          onChange={(event) => {
                            const next = event.target.value;
                            setDraft((current) =>
                              current ? { ...current, identifier: next } : current,
                            );
                          }}
                        />
                      ) : (
                        (node.identifier ?? "—")
                      )}
                    </TableCell>
                    <TableCell>
                      <select
                        aria-label={`Пояс CDR ${node.name}`}
                        value={node.cdrTimezone}
                        disabled={busy}
                        onChange={(event) => void saveZone(node, event.target.value)}
                        className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                      >
                        {CDR_TIMEZONE_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>{packetLabel}</TableCell>
                    <TableCell>
                      {editing ? (
                        <span className="inline-flex gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy || !draft?.name.trim()}
                            onClick={() => void saveRename()}
                          >
                            Сохранить
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setDraft(null)}
                          >
                            Отмена
                          </Button>
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => beginRename(node)}
                        >
                          Переименовать
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || editing}
                        onClick={() => void remove(node)}
                      >
                        Удалить
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  );
}
