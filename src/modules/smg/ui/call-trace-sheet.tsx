"use client";

import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatSmgSummaryCell } from "@/modules/smg/summary";
import type { SmgListItem } from "@/modules/smg/service";
import { formatServerLine, summarizeExchange } from "@/modules/smg-trace/summary";
import type { TraceLookup } from "@/modules/smg-trace/types";

const TRACE_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';

type Props = {
  row: SmgListItem | null;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  trace: TraceLookup | null;
};

function callParty(primary: string | undefined, fallback: string | undefined): string {
  const outgoing = primary?.trim() ?? "";
  if (outgoing) return outgoing;
  const incoming = fallback?.trim() ?? "";
  return incoming || "—";
}

export function SmgCallTraceSheet({ row, onOpenChange, loading, error, trace }: Props) {
  const calling = callParty(row?.outgoingCgpn, row?.incomingCgpn);
  const called = callParty(row?.outgoingCdpn, row?.incomingCdpn);
  const when = row
    ? [formatSmgSummaryCell("setupDay", row), formatSmgSummaryCell("setupClock", row)]
        .filter(Boolean)
        .join(" ")
    : "";

  return (
    <Sheet open={row != null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-3xl"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle className="pr-8 text-lg tabular-nums">
            {calling} → {called}
          </SheetTitle>
          <SheetDescription>{when || "Звонок SMG"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {loading ? <p className="text-sm text-muted-foreground">Загрузка трассы…</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {trace?.status === "missing" ? (
            <p className="text-sm text-muted-foreground">Трассы нет.</p>
          ) : null}
          {trace?.status === "ambiguous" ? (
            <p className="text-sm text-muted-foreground">
              Несколько карточек с этим идентификатором. Ни одна не показана.
            </p>
          ) : null}
          {trace?.status === "ok" ? <TraceBody trace={trace} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TraceBody({ trace }: { trace: Extract<TraceLookup, { status: "ok" }> }) {
  return (
    <>
      {trace.open ? (
        <p className="text-sm text-muted-foreground">В syslog звонок ещё не закрыт.</p>
      ) : null}
      {trace.callref ? (
        <p className="text-xs text-muted-foreground tabular-nums">Callref {trace.callref}</p>
      ) : null}
      {trace.blocks.text ? (
        <>
          <ExchangeSummary closed={!trace.open} blocks={trace.blocks} />
          <Separator />
          <pre
            className="overflow-x-auto text-xs leading-5 whitespace-pre"
            style={{ fontFamily: TRACE_FONT }}
          >
            {trace.blocks.text}
          </pre>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">В syslog нет обмена с АнтиФродом.</p>
      )}
    </>
  );
}

function ExchangeSummary({
  closed,
  blocks,
}: {
  closed: boolean;
  blocks: Extract<TraceLookup, { status: "ok" }>["blocks"];
}) {
  const summary = summarizeExchange({ closed, blocks });
  return (
    <div className="space-y-2 text-sm">
      <p>Результат: {summary.category}</p>
      <p>Статус: {summary.status}</p>
      {summary.stages.map((stage) => (
        <div key={stage.title} className="space-y-1">
          <p className="text-muted-foreground">{stage.title}</p>
          {stage.servers.map((row) => (
            <p key={`${stage.title}-${row.ip}`}>{formatServerLine(row)}</p>
          ))}
        </div>
      ))}
    </div>
  );
}
