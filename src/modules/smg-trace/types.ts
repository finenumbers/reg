/** The raw AntiFraud exchange of one SMG call, stored apart from the CDR row. */

export type TraceAttr = {
  name: string;
  value: string;
};

export type TraceBlocks = {
  text: string;
  mismatch: boolean;
};

export type TraceLookup =
  | { status: "missing" }
  | { status: "ambiguous" }
  | { status: "ok"; open: boolean; callref: string; blocks: TraceBlocks };
