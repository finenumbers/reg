"use client";

import { useState } from "react";
import Link from "next/link";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount } from "@/lib/format-count";
import { formatDisplayTimestamp } from "@/lib/format-display-time";

type Props = {
  title: string;
  column: string;
  names: string[];
  readAt: string | null;
  configured: boolean;
  refreshUrl: string;
  hrefFor: (name: string) => string;
};

export function VatsNameList({
  title,
  column,
  names,
  readAt,
  configured,
  refreshUrl,
  hrefFor,
}: Props) {
  const { timeZone } = useDisplayTimezone();
  const [rows, setRows] = useState(names);
  const [stamp, setStamp] = useState(readAt);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function refresh() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(refreshUrl, { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        names?: string[];
        readAt?: string | null;
        notice?: string | null;
      } | null;
      if (!response.ok || !body || !Array.isArray(body.names)) {
        setError(body?.error ?? "Не удалось обновить список.");
        return;
      }
      setRows(body.names);
      setStamp(body.readAt ?? null);
      setNotice(body.notice ?? null);
    } catch {
      setError("Не удалось обновить список.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
            {title}
          </h1>
          <p className="text-muted-foreground text-sm">
            {stamp ? `Список от ${formatDisplayTimestamp(stamp, timeZone)}` : "Список ещё не читали"}
          </p>
        </div>
        <Button type="button" disabled={pending || !configured} onClick={() => void refresh()}>
          {pending ? "Обновление…" : "Обновить"}
        </Button>
      </div>
      {error ? <p className="text-destructive shrink-0 text-sm">{error}</p> : null}
      {notice ? <p className="text-muted-foreground shrink-0 text-sm">{notice}</p> : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{column}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground">
                    {configured
                      ? "Нет данных. Нажмите «Обновить»."
                      : "Укажите хост, логин и пароль в Настройках ВАТС."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((name) => (
                  <TableRow key={name}>
                    <TableCell>
                      <Link href={hrefFor(name)} className="hover:underline">
                        {name}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground shrink-0 pt-2 text-sm">Всего: {formatCount(rows.length)}</p>
      </div>
    </div>
  );
}
