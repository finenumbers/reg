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
import { AF_CATEGORY } from "@/modules/smg-trace/classify";
import { formatServerLine, summarizeExchange } from "@/modules/smg-trace/summary";
import type { TraceLookup } from "@/modules/smg-trace/types";

/** Saturated on the white call sheet. No `dark:` shade: that variant follows the OS scheme while the sheet stays white. */
export const AF_SUMMARY_PASS_CLASS = "font-bold text-green-600";
export const AF_SUMMARY_BLOCK_CLASS = "font-bold text-red-600";
export const AF_SUMMARY_SERVER_CLASS = "font-bold text-blue-600";

const SERVER_MARK = " — ";
const ACCEPT = "Access-Accept";
const REJECT = "Access-Reject";

export type SummaryTone = "pass" | "block";

/** Whole category only. «Отказ не применён» stays plain beside a red Access-Reject. */
export function categoryTone(category: string): SummaryTone | null {
  if (category === AF_CATEGORY.passed) return "pass";
  if (category === AF_CATEGORY.blocked) return "block";
  return null;
}

export function summaryToneClass(tone: SummaryTone): string {
  return tone === "pass" ? AF_SUMMARY_PASS_CLASS : AF_SUMMARY_BLOCK_CLASS;
}

export type ServerLineParts = {
  server: string;
  lead: string;
  outcome: string;
  outcomeTone: SummaryTone | null;
  tail: string;
};

/**
 * Split one `formatServerLine` result. The first em dash separates the server
 * from the outcome. Access-Accept and Access-Reject count only as a whole token.
 */
export function splitServerSummaryLine(line: string): ServerLineParts {
  const at = line.indexOf(SERVER_MARK);
  if (at < 0) {
    return { server: line, lead: "", outcome: "", outcomeTone: null, tail: "" };
  }
  const body = line.slice(at + SERVER_MARK.length);
  const accept = takeToken(body, ACCEPT);
  if (accept != null) {
    return {
      server: line.slice(0, at),
      lead: SERVER_MARK,
      outcome: ACCEPT,
      outcomeTone: "pass",
      tail: accept,
    };
  }
  const reject = takeToken(body, REJECT);
  if (reject != null) {
    return {
      server: line.slice(0, at),
      lead: SERVER_MARK,
      outcome: REJECT,
      outcomeTone: "block",
      tail: reject,
    };
  }
  return {
    server: line.slice(0, at),
    lead: SERVER_MARK,
    outcome: "",
    outcomeTone: null,
    tail: body,
  };
}

/** The text after the token, when the token ends the body or is followed by a comma. */
function takeToken(body: string, token: string): string | null {
  if (!body.startsWith(token)) return null;
  const next = body[token.length];
  if (next != null && next !== ",") return null;
  return body.slice(token.length);
}

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
        <SheetHeader className="border-border border-b">
          <SheetTitle className="pr-8 text-lg tabular-nums">
            {calling} → {called}
          </SheetTitle>
          <SheetDescription>{when || "Звонок SMG"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {loading ? (
            <p className="text-muted-foreground text-sm">Загрузка трассы…</p>
          ) : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {trace?.status === "missing" ? (
            <p className="text-muted-foreground text-sm">Трассы нет.</p>
          ) : null}
          {trace?.status === "noAntifraud" ? (
            <p className="text-muted-foreground text-sm">Нет АнтиФрода.</p>
          ) : null}
          {trace?.status === "ambiguous" ? (
            <p className="text-muted-foreground text-sm">
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
        <p className="text-muted-foreground text-sm">В syslog звонок ещё не закрыт.</p>
      ) : null}
      {trace.callref ? (
        <p className="text-muted-foreground text-xs tabular-nums">
          Callref {trace.callref}
        </p>
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
        <p className="text-muted-foreground text-sm">В syslog нет обмена с АнтиФродом.</p>
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
  const tone = categoryTone(summary.category);
  return (
    <div className="space-y-2 text-sm">
      <p>
        Результат:{" "}
        {tone ? (
          <span className={summaryToneClass(tone)}>{summary.category}</span>
        ) : (
          summary.category
        )}
      </p>
      <p>Статус: {summary.status}</p>
      {summary.servers.map((row) => (
        <p key={`${row.ip}-${row.requestId}-${row.attempt}`}>
          <ServerSummaryLine line={formatServerLine(row)} />
        </p>
      ))}
    </div>
  );
}

function ServerSummaryLine({ line }: { line: string }) {
  const parts = splitServerSummaryLine(line);
  return (
    <>
      <span className={AF_SUMMARY_SERVER_CLASS}>{parts.server}</span>
      {parts.lead}
      {parts.outcomeTone ? (
        <span className={summaryToneClass(parts.outcomeTone)}>{parts.outcome}</span>
      ) : null}
      {parts.tail}
    </>
  );
}
