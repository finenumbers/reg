/** Five blocks of one SMG call, built from syslog and stored apart from the CDR row. */

export type TraceAttr = {
  name: string;
  value: string;
};

export type TraceLeg = {
  side: string;
  requestId: string;
  requestType: string;
  origin: string;
  attempts: string;
  sessionId: string;
  profile: string;
  tg: string;
  reason: string;
  wait: string;
  server: string;
  numbers: string;
  useAf: string;
  attributes: TraceAttr[];
  reply: string;
  replyCode: string;
  replyAttributes: TraceAttr[];
  replyTime: string;
  ignored: string;
  released: string;
  notes: string[];
};

export type TraceSignalLeg = {
  port: string;
  callId: string;
  messages: string[];
};

export type TraceNumberStep = {
  port: string;
  text: string;
};

export type TraceTime = {
  port: string;
  event: string;
  stamp: string;
  delta: string;
};

export type TraceMedia = {
  port: string;
  codec: string;
  payload: string;
  ptime: string;
  direction: string;
  offer: string;
  rtp: string;
  dtmf: string;
  fax: string;
  vbd: string;
  dscp: string;
};

export type TraceBlocks = {
  antifraud: {
    summary: string;
    rejecting: string;
    mismatch: boolean;
    notes: string[];
    legs: TraceLeg[];
  };
  signal: TraceSignalLeg[];
  numbers: TraceNumberStep[];
  times: TraceTime[];
  media: TraceMedia[];
};

export type TraceLookup =
  | { status: "missing" }
  | { status: "ambiguous" }
  | { status: "ok"; open: boolean; callref: string; blocks: TraceBlocks };
