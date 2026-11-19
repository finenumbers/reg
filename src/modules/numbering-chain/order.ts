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

export type ChainSide = "purchased" | "free" | "both";

export const CHAIN_STEPS: readonly {
  id: ChainSourceId;
  side: ChainSide;
  label: string;
}[] = [
  { id: "sipout", side: "purchased", label: "SipOut, купленные" },
  { id: "sipout", side: "free", label: "SipOut, свободные" },
  { id: "runexis", side: "purchased", label: "Runexis, купленные" },
  { id: "runexis", side: "free", label: "Runexis, свободные" },
  { id: "uis", side: "purchased", label: "UIS, купленные" },
  { id: "uis", side: "free", label: "UIS, свободные" },
  { id: "aurora", side: "free", label: "Aurora Telecom, свободные" },
  { id: "exolve", side: "purchased", label: "MTS Exolve, купленные" },
  { id: "exolve", side: "free", label: "MTS Exolve, свободные" },
  { id: "voximplant", side: "purchased", label: "Voximplant, купленные" },
  { id: "voximplant", side: "free", label: "Voximplant, свободные" },
  { id: "mcn", side: "purchased", label: "MCN Telecom, купленные" },
  { id: "mcn", side: "free", label: "MCN Telecom, свободные" },
  { id: "finenumbers", side: "both", label: "Finenumbers" },
];

export type ChainMode = "idle" | "wait" | "read" | "masks";

export type ChainView = {
  running: boolean;
  queue: string | null;
  banner: string | null;
  cards: Partial<Record<ChainSourceId, string>>;
};
