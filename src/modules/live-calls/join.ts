import type { LiveCallColumnKey } from "@/modules/live-calls/columns";

export type CallTalk = {
  text: string;
  explicitSeconds: boolean;
};

export type CallSide = {
  conferenceId: string;
  values: Partial<Record<LiveCallColumnKey, string>>;
  talk?: CallTalk | null;
};

export type JoinedCall = Record<LiveCallColumnKey, string> & {
  conferenceId: string;
  /** Null when the duration column was not read. Empty when it was read and blank. */
  switchSeconds: string | null;
};

const EMPTY: Record<LiveCallColumnKey, string> = {
  category: "",
  state: "",
  startedAt: "",
  connectedAt: "",
  outA: "",
  sideA: "",
  outB: "",
  sideB: "",
  direction: "",
  seconds: "",
  sourceName: "",
  destName: "",
  dialpeer: "",
  sourceSignal: "",
  destSignal: "",
};

/**
 * Pair rows on Conference ID. A blank id never joins.
 * Extra rows on one side stay, with the other side blank.
 * Order is the switching-subsystem order, then leftover routing rows.
 */
export function joinLiveCalls(
  pcomm: readonly CallSide[],
  pupr: readonly CallSide[],
): JoinedCall[] {
  const puprByKey = new Map<string, CallSide[]>();
  const puprAlone: CallSide[] = [];
  for (const row of pupr) {
    const key = row.conferenceId.trim();
    if (!key) {
      puprAlone.push(row);
      continue;
    }
    const list = puprByKey.get(key);
    if (list) list.push(row);
    else puprByKey.set(key, [row]);
  }

  const used = new Map<string, number>();
  const out: JoinedCall[] = [];
  for (const row of pcomm) {
    const key = row.conferenceId.trim();
    if (!key) {
      out.push(merge(row, null));
      continue;
    }
    const list = puprByKey.get(key) ?? [];
    const index = used.get(key) ?? 0;
    const mate = index < list.length ? list[index] : null;
    if (mate) used.set(key, index + 1);
    out.push(merge(row, mate));
  }
  for (const [key, list] of puprByKey) {
    const index = used.get(key) ?? 0;
    for (let cursor = index; cursor < list.length; cursor += 1) {
      out.push(merge(null, list[cursor] ?? null));
    }
  }
  for (const row of puprAlone) out.push(merge(null, row));
  return out;
}

function pickSwitchSeconds(left: CallSide | null, right: CallSide | null): string | null {
  const talks = [left?.talk, right?.talk].filter(
    (item): item is CallTalk => item != null,
  );
  for (const talk of talks) {
    if (talk.explicitSeconds && talk.text !== "") return talk.text;
  }
  for (const talk of talks) {
    if (talk.text !== "") return talk.text;
  }
  return talks.length > 0 ? "" : null;
}

function merge(left: CallSide | null, right: CallSide | null): JoinedCall {
  return {
    conferenceId: left?.conferenceId.trim() || right?.conferenceId.trim() || "",
    category: EMPTY.category,
    state: right?.values.state ?? EMPTY.state,
    startedAt: left?.values.startedAt ?? EMPTY.startedAt,
    connectedAt: left?.values.connectedAt ?? EMPTY.connectedAt,
    outA: left?.values.outA ?? EMPTY.outA,
    sideA: EMPTY.sideA,
    outB: left?.values.outB ?? EMPTY.outB,
    sideB: EMPTY.sideB,
    direction: EMPTY.direction,
    seconds: EMPTY.seconds,
    switchSeconds: pickSwitchSeconds(left, right),
    sourceName: right?.values.sourceName ?? EMPTY.sourceName,
    destName: right?.values.destName ?? EMPTY.destName,
    dialpeer: right?.values.dialpeer ?? EMPTY.dialpeer,
    sourceSignal: left?.values.sourceSignal ?? EMPTY.sourceSignal,
    destSignal: left?.values.destSignal ?? EMPTY.destSignal,
  };
}
