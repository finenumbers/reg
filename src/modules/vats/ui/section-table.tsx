"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
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
import { VATS_STATUS_POLL_MS } from "@/modules/vats/cadence";
import { nameListHref } from "@/modules/vats/names";
import type { DomainTableRow, TelnumTableRow } from "@/modules/vats/rows";

type StatusSection = "domains" | "telnums" | "settings";

type StatusPayload = {
  loading?: boolean;
  domains?: { readAt?: string | null; notice?: string | null };
  telnums?: { readAt?: string | null; notice?: string | null };
  settings?: { readAt?: string | null; notice?: string | null };
};

export function vatsLoadLine(
  readAt: string | null,
  loading: boolean,
  timeZone: string,
): string {
  const base = readAt
    ? `Загрузка от ${formatDisplayTimestamp(readAt, timeZone)}`
    : "Данные ещё не загружались";
  return loading ? `${base} Идёт загрузка.` : base;
}

export function VatsLoadStatus({
  section,
  readAt,
  notice,
}: {
  section: StatusSection;
  readAt: string | null;
  notice: string | null;
}) {
  const router = useRouter();
  const { timeZone } = useDisplayTimezone();
  const [polled, setPolled] = useState<{
    readAt: string | null;
    notice: string | null;
    loading: boolean;
  } | null>(null);
  const [tracked, setTracked] = useState(readAt);
  if (tracked !== readAt) {
    setTracked(readAt);
    setPolled(null);
  }
  const stamp = polled?.readAt ?? readAt;
  const text = polled?.notice ?? notice;
  const loading = polled?.loading ?? false;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/vats/status");
        if (!response.ok) return;
        const body = (await response.json()) as StatusPayload;
        const part = body[section];
        if (stopped || !part) return;
        const next = part.readAt ?? null;
        setPolled({
          readAt: next,
          notice: part.notice ?? null,
          loading: Boolean(body.loading),
        });
        if (next !== readAt) router.refresh();
      } catch {
        // The last snapshot stays on screen.
      }
    }

    function arm() {
      if (timer) clearInterval(timer);
      timer = null;
      if (document.visibilityState !== "visible") return;
      void tick();
      timer = setInterval(() => void tick(), VATS_STATUS_POLL_MS);
    }

    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [section, readAt, router]);

  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-sm">
        {vatsLoadLine(stamp, loading, timeZone)}
      </p>
      {text ? <p className="text-muted-foreground text-sm">{text}</p> : null}
    </div>
  );
}

type Common = {
  title: string;
  readAt: string | null;
  notice: string | null;
  total: number;
};

export function VatsDomainTable({
  title,
  readAt,
  notice,
  total,
  rows,
}: Common & { rows: DomainTableRow[] }) {
  return (
    <SectionFrame
      section="domains"
      title={title}
      readAt={readAt}
      notice={notice}
      total={total}
      rows={rows}
    >
      {(shown) => (
        <>
          <TableHeader>
            <TableRow>
              <TableHead>Домен</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Абоненты</TableHead>
              <TableHead>Диал-план</TableHead>
              <TableHead>Блокировка</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Нет данных.
                </TableCell>
              </TableRow>
            ) : (
              shown.map((row) => (
                <TableRow key={row.name}>
                  <TableCell>
                    <Link
                      href={nameListHref("/vats/domains", row.name)}
                      className="hover:underline"
                    >
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell>{row.client}</TableCell>
                  <TableCell>{row.subscribers}</TableCell>
                  <TableCell>{row.dialplan}</TableCell>
                  <TableCell>{row.frozen}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </>
      )}
    </SectionFrame>
  );
}

export function VatsTelnumTable({
  title,
  readAt,
  notice,
  total,
  rows,
}: Common & { rows: TelnumTableRow[] }) {
  return (
    <SectionFrame
      section="telnums"
      title={title}
      readAt={readAt}
      notice={notice}
      total={total}
      rows={rows}
    >
      {(shown) => (
        <>
          <TableHeader>
            <TableRow>
              <TableHead>Номер</TableHead>
              <TableHead>Домен</TableHead>
              <TableHead>FMC</TableHead>
              <TableHead>Шлюзы</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Нет данных.
                </TableCell>
              </TableRow>
            ) : (
              shown.map((row) => (
                <TableRow key={row.telnum}>
                  <TableCell>
                    <Link
                      href={nameListHref("/vats/telnums", row.telnum)}
                      className="hover:underline"
                    >
                      {row.telnum}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.domainHref ? (
                      <Link
                        href={nameListHref("/vats/domains", row.domainHref)}
                        className="hover:underline"
                      >
                        {row.domain}
                      </Link>
                    ) : (
                      row.domain
                    )}
                  </TableCell>
                  <TableCell>{row.fmc}</TableCell>
                  <TableCell>{row.gateways}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </>
      )}
    </SectionFrame>
  );
}

function SectionFrame<T extends { name?: string; telnum?: string }>({
  section,
  title,
  readAt,
  notice,
  total,
  rows,
  children,
}: Common & {
  section: "domains" | "telnums";
  rows: T[];
  children: (shown: T[]) => ReactNode;
}) {
  const [snap, setSnap] = useState<{ readAt: string | null; extra: T[] }>({
    readAt,
    extra: [],
  });
  const sentinel = useRef<HTMLDivElement | null>(null);
  const busy = useRef(false);
  if (snap.readAt !== readAt) {
    setSnap({ readAt, extra: [] });
  }
  const page = snap.readAt === readAt ? snap.extra : [];
  const shown = page.length === 0 ? rows : [...rows, ...page];

  useEffect(() => {
    const node = sentinel.current;
    if (!node || shown.length >= total) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (busy.current || shown.length >= total) return;
      busy.current = true;
      const offset = shown.length;
      const requested = readAt;
      void fetch(`/api/vats/rows?section=${section}&offset=${offset}`)
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as { rows?: T[] };
          const next = body.rows;
          if (!Array.isArray(next) || next.length === 0) return;
          setSnap((current) => {
            if (current.readAt !== requested) return current;
            return { readAt: current.readAt, extra: [...current.extra, ...next] };
          });
        })
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
        });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [readAt, section, shown.length, total]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          {title}
        </h1>
        <VatsLoadStatus section={section} readAt={readAt} notice={notice} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>{children(shown)}</Table>
          <div ref={sentinel} className="h-1" />
        </div>
        <p className="text-muted-foreground shrink-0 pt-2 text-sm">
          Всего: {formatCount(total)}
        </p>
      </div>
    </div>
  );
}
