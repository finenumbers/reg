export const CHAIN_SOURCES = [
  { id: "sipout", label: "SipOut", provider: "SipOut" },
  { id: "runexis", label: "Runexis", provider: "Runexis" },
  { id: "uis", label: "UIS", provider: "UIS" },
  { id: "aurora", label: "Aurora Telecom", provider: "Aurora Telecom" },
  { id: "exolve", label: "MTS Exolve", provider: "MTS Exolve" },
  { id: "voximplant", label: "Voximplant", provider: "Voximplant" },
  { id: "mcn", label: "MCN Telecom", provider: "MCN Telecom" },
  { id: "finenumbers", label: "Finenumbers", provider: "Finenumbers" },
] as const;

export type ChainSourceId = (typeof CHAIN_SOURCES)[number]["id"];

export type ChainMode = "idle" | "wait" | "read" | "masks";

export type ChainView = {
  running: boolean;
  queue: string | null;
  banner: string | null;
  cards: Partial<Record<ChainSourceId, string>>;
};
