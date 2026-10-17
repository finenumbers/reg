"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatSmgSummaryCell } from "@/modules/smg/summary";
import type { SmgListItem } from "@/modules/smg/service";
import type { TraceLookup } from "@/modules/smg-trace/types";

type Props = {
  row: SmgListItem | null;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  trace: TraceLookup | null;
};

export function SmgCallTraceSheet({ row, onOpenChange, loading, error, trace }: Props) {
  const calling = row?.incomingCgpn || "—";
  const called = row?.outgoingCdpn || row?.incomingCdpn || "—";
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
        <pre className="overflow-x-auto font-mono text-xs leading-5 whitespace-pre">
          {trace.blocks.text}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">В syslog нет обмена с АнтиФродом.</p>
      )}
    </>
  );
}
