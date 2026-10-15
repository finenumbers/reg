"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LoadAgeChip } from "@/modules/traffic/ui/load-age-chip";
import { formatElapsed } from "@/modules/traffic/load-age";
import type {
  DashboardBadge,
  DashboardCard,
  DashboardSnapshot,
} from "@/modules/dashboard/types";

const POLL_MS = 30_000;

const BADGE_CLASS: Record<DashboardBadge, string> = {
  ok: "bg-emerald-600 text-white",
  running: "",
  failed: "bg-red-600 text-white",
  empty: "",
  off: "",
};

export function DashboardView() {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let loading = false;

    const load = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as DashboardSnapshot;
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Не удалось обновить сводку.");
      } finally {
        loading = false;
      }
    };

    const stop = () => {
      if (timer == null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (cancelled || timer != null) return;
      timer = window.setInterval(() => {
        void load();
      }, POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      void load();
      start();
    };

    void load();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {data == null && error == null ? (
        <p className="text-muted-foreground text-sm">…</p>
      ) : null}
      {data && data.alerts.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Требует внимания">
          {data.alerts.map((alert) => (
            <li
              key={alert.id}
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                alert.tone === "alert"
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "bg-muted/40",
              )}
            >
              {alert.href ? (
                <Link href={alert.href} className="underline-offset-4 hover:underline">
                  {alert.text}
                </Link>
              ) : (
                alert.text
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {data && data.cards.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.cards.map((card) => (
            <DashboardCardView key={card.id} card={card} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DashboardCardView({ card }: { card: DashboardCard }) {
  const outline =
    card.badge === "running" || card.badge === "empty" || card.badge === "off";
  return (
    <Link
      href={card.href}
      className="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
    >
      <Card className="hover:bg-muted/30 h-full transition-colors" size="sm">
        <CardHeader>
          <CardTitle>{card.title}</CardTitle>
          <CardAction>
            <Badge
              variant={outline ? "outline" : "default"}
              className={BADGE_CLASS[card.badge]}
            >
              {card.badgeLabel}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <AgeLine card={card} />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            {card.stats.map((stat) => (
              <div key={stat.label}>
                <dt className="text-muted-foreground text-xs">{stat.label}</dt>
                <dd className="text-sm font-medium tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
          {card.note ? (
            <p className="text-muted-foreground text-sm">{card.note}</p>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}

function AgeLine({ card }: { card: DashboardCard }) {
  if (card.load) {
    return (
      <LoadAgeChip
        lastPassAt={card.load.at}
        hadCalls={card.load.hadCalls}
        lastCheckedAt={card.load.lastCheckedAt}
        colored
      />
    );
  }
  if (card.successAt) return <ClockLine prefix="последний успех" at={card.successAt} />;
  if (card.packetAt) return <ClockLine prefix="последний пакет" at={card.packetAt} />;
  if (card.emptyAge)
    return <p className="text-muted-foreground text-sm">{card.emptyAge}</p>;
  return null;
}

function ClockLine({ prefix, at }: { prefix: string; at: string }) {
  const [now, setNow] = useState(() => Date.now());
  const ms = Date.parse(at);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [at]);

  if (!Number.isFinite(ms)) return null;
  return (
    <p className="text-muted-foreground text-sm">
      {prefix}:{" "}
      <span className="font-semibold tabular-nums">{formatElapsed(now - ms)}</span>
    </p>
  );
}
