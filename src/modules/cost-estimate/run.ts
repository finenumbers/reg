/**
 * Ephemeral cost-estimate: parse → rate → XLSX buffer.
 */

import { loadOprsToneReport } from "@/modules/oprs/operator-tone-load";
import { buildCostEstimateRows } from "@/modules/cost-estimate/compute";
import { parseCostEstimateXlsx } from "@/modules/cost-estimate/parse-xlsx";
import {
  pstnLookupBatch,
  pstnSnapshotHasRows,
} from "@/modules/cost-estimate/pstn-batch";
import {
  COST_ESTIMATE_TONE_ERROR,
  type CostEstimateRunResult,
} from "@/modules/cost-estimate/types";
import { writeCostEstimateXlsx } from "@/modules/cost-estimate/write-xlsx";
import { loadTariffRateLookup } from "@/modules/tariffs/service";

export async function runCostEstimate(
  buffer: Buffer,
): Promise<CostEstimateRunResult> {
  const parsed = await parseCostEstimateXlsx(buffer);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      error: parsed.error,
      details: parsed.details,
    };
  }

  const tone = await loadOprsToneReport(Date.now(), { wait: true });
  if (!tone.labelUnpainted) {
    return {
      ok: false,
      status: 503,
      error: COST_ESTIMATE_TONE_ERROR,
      details: [COST_ESTIMATE_TONE_ERROR],
    };
  }

  const digits = parsed.rows.map((row) => row.bDigits);
  const [rates, pstn, pstnSnapshotEmpty] = await Promise.all([
    loadTariffRateLookup(),
    pstnLookupBatch(digits),
    pstnSnapshotHasRows().then((has) => !has),
  ]);

  const output = buildCostEstimateRows({
    rows: parsed.rows,
    rates,
    pstn,
    toneMap: tone.map,
    labelUnpainted: tone.labelUnpainted,
  });

  const file = await writeCostEstimateXlsx(output);
  return {
    ok: true,
    buffer: file.buffer,
    filename: file.filename,
    pstnSnapshotEmpty,
  };
}
