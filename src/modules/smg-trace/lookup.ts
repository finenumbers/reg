import { prisma } from "@/lib/db";
import { decideTraceRows, type TraceHitRow } from "@/modules/smg-trace/match";
import { traceSearchKeys } from "@/modules/smg-trace/tag";
import type { TraceBlocks, TraceLookup } from "@/modules/smg-trace/types";

/**
 * The CDR row is found by its own id. The card is found by UniqueTag or the
 * accounting session id. A different number or the node identifier does not hide a card.
 */
export async function lookupSmgTrace(cdrId: string): Promise<TraceLookup | null> {
  const record = await prisma.smgCdrRecord.findUnique({
    where: { id: cdrId },
    select: { uniqueTag: true, radiusSessionId: true },
  });
  if (!record) return null;

  const keys = traceSearchKeys(record.uniqueTag, record.radiusSessionId);
  if (keys.length === 0) return { status: "missing" };

  const rows = await prisma.smgCallTrace.findMany({
    where: { tagNorm: { in: keys } },
    select: { deviceIp: true, open: true, callref: true, blocks: true },
  });
  const hits: TraceHitRow[] = [];
  for (const row of rows) {
    if (!isBlocks(row.blocks)) continue;
    hits.push({
      deviceIp: row.deviceIp,
      open: row.open,
      callref: row.callref,
      blocks: row.blocks,
    });
  }
  return decideTraceRows(hits);
}

function isBlocks(value: unknown): value is TraceBlocks {
  if (!value || typeof value !== "object") return false;
  const row = value as { antifraud?: unknown };
  return row.antifraud != null && typeof row.antifraud === "object";
}
