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
import type {
  TraceAttr,
  TraceBlocks,
  TraceLeg,
  TraceLookup,
} from "@/modules/smg-trace/types";
import type { ReactNode } from "react";

type Props = {
  row: SmgListItem | null;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  trace: TraceLookup | null;
};

const SIDE: Record<string, string> = {
  in: "Входящее",
  out: "Исходящее",
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
          {trace?.status === "ok" ? (
            <TraceBody trace={trace} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TraceBody({ trace }: { trace: Extract<TraceLookup, { status: "ok" }> }) {
  const blocks = trace.blocks;
  return (
    <>
      {trace.open ? (
        <p className="text-sm text-muted-foreground">В syslog звонок ещё не закрыт.</p>
      ) : null}
      {trace.callref ? (
        <p className="text-xs text-muted-foreground tabular-nums">Callref {trace.callref}</p>
      ) : null}
      <Block title="Антифрод">
        <Antifraud blocks={blocks} />
      </Block>
      <Block title="Сигнальный обмен">
        {blocks.signal.length === 0 ? (
          <Empty>В этой трассе нет сигнальных сообщений.</Empty>
        ) : (
          blocks.signal.map((leg) => (
            <section key={leg.port || leg.callId} className="space-y-1">
              <h4 className="text-sm font-medium">{leg.port || "Плечо"}</h4>
              <Fields
                rows={[
                  ["Call-ID", leg.callId],
                  ["Сообщения", leg.messages.join(", ")],
                ]}
              />
            </section>
          ))
        )}
      </Block>
      <Block title="Номера и маршрут">
        {blocks.numbers.length === 0 ? (
          <Empty>В этой трассе нет смены номера.</Empty>
        ) : (
          <ol className="space-y-1">
            {blocks.numbers.map((step, index) => (
              <li key={`${step.port}-${step.text}-${index}`} className="text-sm">
                {step.port ? <span className="text-muted-foreground">{step.port}. </span> : null}
                {step.text}
              </li>
            ))}
          </ol>
        )}
      </Block>
      <Block title="Время плеч">
        {blocks.times.length === 0 ? (
          <Empty>В этой трассе нет меток времени.</Empty>
        ) : (
          <ul className="space-y-1">
            {blocks.times.map((row, index) => (
              <li key={`${row.port}-${row.event}-${index}`} className="text-sm tabular-nums">
                {[row.port, row.event, row.stamp, row.delta].filter(Boolean).join(" · ")}
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="Медиа">
        {blocks.media.length === 0 ? (
          <Empty>В этой трассе нет согласованного медиа.</Empty>
        ) : (
          blocks.media.map((leg, index) => (
            <section key={`${leg.port}-${index}`} className="space-y-1">
              <h4 className="text-sm font-medium">{leg.port || "Плечо"}</h4>
              <Fields
                rows={[
                  ["Кодек", leg.codec],
                  ["Payload", leg.payload],
                  ["ptime", leg.ptime],
                  ["Направление", leg.direction],
                  ["Offer", leg.offer],
                  ["RTP", leg.rtp],
                  ["DTMF", leg.dtmf],
                  ["Факс", leg.fax],
                  ["VBD", leg.vbd],
                  ["DSCP", leg.dscp],
                ]}
              />
            </section>
          ))
        )}
      </Block>
    </>
  );
}

function Antifraud({ blocks }: { blocks: TraceBlocks }) {
  const block = blocks.antifraud;
  return (
    <div className="space-y-3">
      <p className="text-sm">{block.summary}</p>
      {block.mismatch ? (
        <p className="text-sm">
          h323-conf-id не совпал с UniqueTag. Второй звонок не присоединён.
        </p>
      ) : null}
      {block.rejecting ? (
        <p className="text-sm tabular-nums">RADIUS server rejected: {block.rejecting}</p>
      ) : null}
      {block.notes.map((note) => (
        <p key={note} className="text-sm text-muted-foreground">
          {note}
        </p>
      ))}
      {block.legs.map((leg, index) => (
        <LegCard key={`${leg.side}-${leg.requestId}-${index}`} leg={leg} />
      ))}
    </div>
  );
}

function LegCard({ leg }: { leg: TraceLeg }) {
  return (
    <section className="space-y-2 border-t border-border pt-3">
      <h4 className="text-sm font-medium">{SIDE[leg.side] || "Плечо"}</h4>
      <Fields
        rows={[
          ["Request ID", leg.requestId],
          ["Тип запроса", leg.requestType],
          ["Направление RADIUS", leg.origin],
          ["Попытки", leg.attempts],
          ["Сессия плеча", leg.sessionId],
          ["Профиль", leg.profile],
          ["Транк-группа", leg.tg],
          ["Причина", leg.reason],
          ["Ожидание", leg.wait],
          ["Сервер", leg.server],
          ["Номера в запросе", leg.numbers],
          ["USE_AF", leg.useAf],
          ["Ответ", leg.reply],
          ["Код пакета", leg.replyCode],
          ["Время ответа", leg.replyTime],
          ["Ответ не применён", leg.ignored],
          ["Разъединение", leg.released],
        ]}
      />
      <AttrList title="Атрибуты запроса" attrs={leg.attributes} />
      <AttrList title="Атрибуты ответа" attrs={leg.replyAttributes} />
      {leg.notes.map((note) => (
        <p key={note} className="text-sm text-muted-foreground">
          {note}
        </p>
      ))}
    </section>
  );
}

function AttrList({ title, attrs }: { title: string; attrs: TraceAttr[] }) {
  if (attrs.length === 0) return null;
  return (
    <div className="space-y-1">
      <h5 className="text-xs font-medium text-muted-foreground">{title}</h5>
      <ul className="space-y-0.5">
        {attrs.map((attr, index) => (
          <li key={`${attr.name}-${index}`} className="font-mono text-xs break-all">
            {attr.name} = {attr.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border border-border px-3 py-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Fields({ rows }: { rows: [string, string][] }) {
  const visible = rows.filter(([, value]) => value !== "");
  if (visible.length === 0) return null;
  return (
    <dl className="space-y-1">
      {visible.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[9.5rem_1fr] gap-x-3 text-sm">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
