import { SATEL_CALL_ID_FIELDS } from "@/modules/voipmonitor/constants";
import { firstNonEmpty, uniqueNonEmpty } from "@/modules/voipmonitor/normalize";
import { SOURCE_SATEL, type CdrCandidate } from "@/modules/voipmonitor/types";

export type SatelCdrRow = {
  id: string;
  cdrId: string;
  cdrAt: Date | null;
  billAni: string;
  billDnis: string;
  inAni: string;
  inDnis: string;
  outAni: string;
  outDnis: string;
  elapsedTime: string;
  connectTime: string;
  disconnectTime: string;
  remoteSrcSigAddress: string;
  remoteDstSigAddress: string;
  localSrcSigAddress: string;
  localDstSigAddress: string;
  outLegCallId: string;
  srcOutLegCallId: string;
  inLegCallId: string;
  srcInLegCallId: string;
  srcInLegConfId: string;
  confId: string;
};

/** Softswitch elapsed_time is milliseconds. */
function parseSeconds(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.ceil(n / 1000);
}

function parseConnectDuration(connect: string, disconnect: string): number | null {
  const start = Date.parse(connect.trim());
  const end = Date.parse(disconnect.trim());
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return Math.round((end - start) / 1000);
}

function stripHostPort(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const host = trimmed.split(":")[0] ?? trimmed;
  return host.trim();
}

export function candidateFromSatelRow(row: SatelCdrRow): CdrCandidate | null {
  if (!row.cdrAt) return null;
  const sipCallIds = uniqueNonEmpty(
    ...SATEL_CALL_ID_FIELDS.map((field) => row[field]),
  );
  return {
    sourceRecordId: row.id,
    sourceSystem: SOURCE_SATEL,
    sourceCdrId: row.cdrId,
    setupTime: row.cdrAt,
    durationSec: parseSeconds(row.elapsedTime),
    connectDurationSec: parseConnectDuration(row.connectTime, row.disconnectTime),
    caller: firstNonEmpty(row.billAni, row.outAni, row.inAni),
    called: firstNonEmpty(row.billDnis, row.outDnis, row.inDnis),
    callerNumbers: uniqueNonEmpty(row.billAni, row.outAni, row.inAni),
    calledNumbers: uniqueNonEmpty(row.billDnis, row.outDnis, row.inDnis),
    callerIp: firstNonEmpty(
      stripHostPort(row.remoteSrcSigAddress),
      stripHostPort(row.localSrcSigAddress),
    ),
    calledIp: firstNonEmpty(
      stripHostPort(row.remoteDstSigAddress),
      stripHostPort(row.localDstSigAddress),
    ),
    sipCallIds,
  };
}
