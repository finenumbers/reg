import type { TraceBlocks, TraceLookup } from "@/modules/smg-trace/types";

export type TraceHitRow = {
  deviceIp: string;
  open: boolean;
  callref: string;
  blocks: TraceBlocks;
};

/** One card is shown. Two cards, or the same tag on two gateways, are not chosen between. */
export function decideTraceRows(rows: readonly TraceHitRow[]): TraceLookup {
  if (rows.length === 0) return { status: "missing" };
  const ips = new Set(rows.map((row) => row.deviceIp));
  if (rows.length > 1 || ips.size > 1) return { status: "ambiguous" };
  const row = rows[0]!;
  return {
    status: "ok",
    open: row.open,
    callref: row.callref,
    blocks: row.blocks,
  };
}
