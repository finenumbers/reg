/** The raw AntiFraud exchange of one SMG call, stored apart from the CDR row. */

export type TraceAttr = {
  name: string;
  value: string;
};

export type TraceBlocks = {
  text: string;
  mismatch: boolean;
  /** Slot where this card's call was first seen. Absent on cards written before version 6. */
  startedKey?: string;
};

export type TraceLookup =
  | { status: "missing" }
  | { status: "noAntifraud" }
  | { status: "ambiguous" }
  | { status: "ok"; open: boolean; callref: string; blocks: TraceBlocks };
