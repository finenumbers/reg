"use client";

import { useEffect, useState, type CSSProperties } from "react";
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
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { FitSelect } from "@/components/fit-select";
import { LoadAgeChip } from "@/modules/traffic/ui/load-age-chip";
import { formatElapsed } from "@/modules/traffic/load-age";
import { ALL_ANTIFRAUD_NODES_LABEL } from "@/modules/dashboard/antifraud-nodes";
import {
  DASHBOARD_SERIES,
  isAntifraudChartSeries,
  parseDashboardSeries,
  type DashboardSeriesId,
} from "@/modules/dashboard/series";
import type {
  DashboardBadge,
  DashboardCard,
  DashboardSnapshot,
} from "@/modules/dashboard/types";
import { CallsChart } from "@/modules/dashboard/ui/calls-chart";

const POLL_MS = 30_000;

const SERIES_OPTIONS = DASHBOARD_SERIES.map((item) => ({
  value: item.id,
  label: item.label,
}));

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
  const [series, setSeries] = useState<DashboardSeriesId>("phone");
  const [node, setNode] = useState("");

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
          setNode((current) => {
            if (current === "" || !Array.isArray(body.antifraudNodes)) return current;
            if (body.antifraudNodes.some((item) => item.ip === current)) return current;
            return "";
          });
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

  const antifraud = isAntifraudChartSeries(series);
  const listedNodes = data?.antifraudNodes ?? null;
  const selectedNode =
    node !== "" &&
    Array.isArray(listedNodes) &&
    !listedNodes.some((item) => item.ip === node)
      ? ""
      : node;
  const chartNode = antifraud && selectedNode !== "" ? selectedNode : null;
  const nodeOptions = [
    { value: "", label: ALL_ANTIFRAUD_NODES_LABEL },
    ...(listedNodes ?? []).map((item) => ({ value: item.ip, label: item.name })),
  ];
  if (listedNodes == null && selectedNode !== "") {
    nodeOptions.push({ value: selectedNode, label: selectedNode });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4">
        <h1 className="min-w-0 text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Finenumbers OSS Platform
        </h1>
        {data?.calls ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {antifraud ? (
              <FitSelect
                id="dashboard-af-node"
                value={selectedNode}
                options={nodeOptions}
                onChange={setNode}
                aria-label="Узел Eltex SMG-1016M"
                textClassName={FILTER_TOOLBAR_TEXT}
              />
            ) : null}
            <FitSelect
              id="dashboard-call-series"
              value={series}
              options={SERIES_OPTIONS}
              onChange={(value) => {
                const next = parseDashboardSeries(value);
                if (next === value) setSeries(next);
              }}
              aria-label="Вид трафика"
              textClassName={FILTER_TOOLBAR_TEXT}
            />
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4">
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
                    <Link
                      href={alert.href}
                      className="underline-offset-4 hover:underline"
                    >
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
            <div className="@container">
              <div className="grid grid-cols-1 gap-2 @min-[40rem]:grid-cols-2 @min-[60rem]:grid-cols-3 @min-[72rem]:grid-cols-5">
                {data.cards.map((card) => (
                  <DashboardCardView key={card.id} card={card} />
                ))}
              </div>
            </div>
          ) : null}
          {data?.calls ? <CallsChart series={series} node={chartNode} /> : null}
        </div>
      </div>
    </div>
  );
}

function DashboardCardView({ card }: { card: DashboardCard }) {
  const outline =
    card.badge === "running" || card.badge === "empty" || card.badge === "off";
  return (
    <Link
      href={card.href}
      className="focus-visible:ring-ring min-w-0 rounded-xl focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
    >
      <Card
        className="hover:bg-muted/30 h-full transition-colors"
        size="sm"
        style={{ "--card-spacing": "0.5rem" } as CSSProperties}
      >
        <CardHeader className="items-center">
          <CardTitle className="min-w-0 truncate" title={card.title}>
            {card.title}
          </CardTitle>
          <CardAction className="self-center">
            <Badge
              variant={outline ? "outline" : "default"}
              className={cn("shrink-0", BADGE_CLASS[card.badge])}
            >
              {card.badgeLabel}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <dl className="flex flex-col gap-0.5">
            {card.stats.map((stat) => (
              <div key={stat.label} className="flex items-baseline justify-between gap-2">
                <dt
                  className="text-muted-foreground min-w-0 truncate text-xs"
                  title={stat.label}
                >
                  {stat.label}
                </dt>
                <dd className="shrink-0 text-xs font-medium tabular-nums">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
          <AgeLine card={card} />
          {card.note ? (
            <p className="text-muted-foreground text-xs leading-snug">{card.note}</p>
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
        className="text-xs"
      />
    );
  }
  if (card.successAt) return <ClockLine prefix="последний успех" at={card.successAt} />;
  if (card.packetAt) return <ClockLine prefix="последний пакет" at={card.packetAt} />;
  if (card.emptyAge)
    return <p className="text-muted-foreground text-xs">{card.emptyAge}</p>;
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
    <p className="text-muted-foreground text-xs">
      {prefix}:{" "}
      <span className="font-semibold tabular-nums">{formatElapsed(now - ms)}</span>
    </p>
  );
}
