"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBytes } from "@/modules/storage/format-bytes";
import type { SyslogStatus } from "@/modules/smg-syslog/status";

type NodeRow = { ip: string; name: string };

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
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/settings/smg-syslog", { cache: "no-store" });
    if (!res.ok) return;
    setData((await res.json()) as Payload);
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
        body: JSON.stringify({ ip, name }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Не удалось добавить узел");
        return;
      }
      setIp("");
      setName("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function rename(node: NodeRow) {
    const next = window.prompt("Название узла", node.name);
    if (next == null) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/settings/smg-syslog/nodes/${encodeURIComponent(node.ip)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Не удалось переименовать узел");
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(node: NodeRow) {
    if (!window.confirm(`Удалить узел ${node.name}? Уже записанные файлы останутся на диске.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/settings/smg-syslog/nodes/${encodeURIComponent(node.ip)}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Не удалось удалить узел");
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const status = data?.status;
  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold">Syslog — SMG</h2>
      <p className="text-sm text-muted-foreground">
        На шлюзе укажите UDP-порт {data?.advertisePort ?? "514"} и IP этого хоста. В список
        попадает адрес, с которого пакет приходит на сервер. Неизвестный адрес не сохраняется.
        Трассировки, история команд и журнал доступа направляются на один и тот же адрес.
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
        <p className="text-sm text-destructive">{status.bindError}</p>
      ) : null}
      {status?.bridgeWarning ? (
        <p className="text-sm text-destructive">
          Пакеты приходят с адреса моста Docker, а не с адреса шлюза. На демоне Docker выключите
          userland-proxy и пересоздайте контейнер приёмника.
        </p>
      ) : null}
      {status?.lowSpace ? (
        <p className="text-sm text-destructive">
          На томе Syslog меньше 1 ГБ свободно
          {status.freeBytes != null ? ` (${formatBytes(status.freeBytes)})` : ""}. Запись
          продолжается, пока место не кончится.
        </p>
      ) : null}
      {status && status.unknownTotal > 0 ? (
        <p className="text-sm text-muted-foreground">
          Отброшено с неизвестных адресов: {status.unknownTotal}
          {status.unknown.length > 0
            ? `. Последние: ${status.unknown.map((row) => row.ip).join(", ")}`
            : ""}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
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
        <Button type="button" disabled={busy || !ip.trim() || !name.trim()} onClick={() => void addNode()}>
          Добавить
        </Button>
      </div>
      <ul className="space-y-2">
        {(data?.nodes ?? []).map((node) => (
          <li key={node.ip} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{node.name}</span>
            <span className="text-muted-foreground">{node.ip}</span>
            <span className="text-muted-foreground">
              {status?.lastPacket[node.ip]
                ? `последний пакет ${status.lastPacket[node.ip]}`
                : "с запуска пакетов не было"}
            </span>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void rename(node)}>
              Переименовать
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void remove(node)}>
              Удалить
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
