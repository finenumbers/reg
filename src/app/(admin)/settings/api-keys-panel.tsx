"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { formatDisplayTimestamp } from "@/lib/format-display-time";

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  enabled: boolean;
  permissions: string[];
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export function ApiKeysPanel() {
  const { timeZone } = useDisplayTimezone();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [name, setName] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/settings/api-keys");
    if (!res.ok) {
      throw new Error("Не удалось загрузить API-ключи");
    }
    const body = (await res.json()) as { keys: ApiKeyRow[] };
    setKeys(body.keys);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload().catch((err) => {
      toast.error(err instanceof Error ? err.message : "Ошибка загрузки");
    });
  }, [reload]);

  function onCreate() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings/api-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const body = (await res.json()) as {
          key?: ApiKeyRow;
          apiKey?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(body.error ?? "Не удалось создать ключ");
        }
        setCreatedSecret(body.apiKey ?? null);
        setName("");
        await reload();
        toast.success("API-ключ создан — скопируйте секрет сейчас");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка");
      }
    });
  }

  function onRevoke(id: string) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/settings/api-keys/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? "Не удалось отозвать ключ");
        }
        await reload();
        toast.success("Ключ отозван");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка");
      }
    });
  }

  async function copySecret() {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      toast.success("Скопировано в буфер");
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">API-ключи</h2>
        <p className="text-sm text-muted-foreground">
          Read-only доступ для внутренних систем:{" "}
          <code className="text-xs">Authorization: Bearer …</code> или{" "}
          <code className="text-xs">X-Api-Key</code>. Права: regs:read,
          phones:read. Лимит: 10 000 запросов / мин на ключ. Секрет показывается
          только при создании.
        </p>
      </div>

      {createdSecret ? (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-medium">Новый секрет (один раз)</p>
          <code className="block break-all text-xs">{createdSecret}</code>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void copySecret()}>
              Копировать
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setCreatedSecret(null)}
            >
              Скрыть
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-2">
          <Label htmlFor="api-key-name">Имя</Label>
          <Input
            id="api-key-name"
            placeholder="billing, crm…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
          />
        </div>
        <Button
          type="button"
          disabled={pending || !name.trim()}
          onClick={onCreate}
        >
          Создать ключ
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Имя</th>
              <th className="px-3 py-2 font-medium">Prefix</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium">Последнее использование</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={5}>
                  Загрузка…
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={5}>
                  Ключей пока нет
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{k.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{k.keyPrefix}…</td>
                  <td className="px-3 py-2">
                    {k.enabled ? (
                      <Badge variant="secondary">активен</Badge>
                    ) : (
                      <Badge variant="outline">отозван</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatDisplayTimestamp(k.lastUsedAt, timeZone)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {k.enabled ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => onRevoke(k.id)}
                      >
                        Отозвать
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
