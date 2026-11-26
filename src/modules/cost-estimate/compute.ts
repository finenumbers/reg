/**
 * Rate one cost-estimate input sheet into output rows.
 */

import { OPRS_EXTERNAL_NETWORK, oprsNetworkLabel } from "@/modules/oprs/derived";
import { oprsOperatorTone } from "@/modules/oprs/operator-tone";
import type { OprsOperatorToneMap } from "@/modules/oprs/operator-tone";
import { classifyCostEstimateType } from "@/modules/cost-estimate/classify";
import { secondsToElapsedMsString } from "@/modules/cost-estimate/normalize";
import type {
  CostEstimateInputRow,
  CostEstimateOutputRow,
  CostEstimatePstnFields,
} from "@/modules/cost-estimate/types";
import {
  CALL_CATEGORY,
  CALL_STATUS,
  CALL_TYPE,
} from "@/modules/traffic/call-class";
import {
  rateCdrCall,
  type TariffRateLookup,
} from "@/modules/traffic/cdr-tariff";

export function buildCostEstimateRows(input: {
  rows: readonly CostEstimateInputRow[];
  rates: readonly TariffRateLookup[];
  pstn: ReadonlyMap<string, CostEstimatePstnFields>;
  toneMap: OprsOperatorToneMap;
  labelUnpainted: boolean;
}): CostEstimateOutputRow[] {
  return input.rows.map((row) => {
    const callType = classifyCostEstimateType(row.bDigits, input.rates);
    const tariff = rateCdrCall({
      category: CALL_CATEGORY.outgoing,
      callType,
      status: CALL_STATUS.success,
      billDnis: row.bDigits,
      elapsedTime: secondsToElapsedMsString(row.seconds),
      rates: input.rates,
    });
    const pstn = input.pstn.get(row.bDigits) ?? {
      operator: "",
      geography: "",
    };

    let network = "";
    let fillTone: CostEstimateOutputRow["fillTone"] = null;
    if (callType === CALL_TYPE.mobile) {
      const tone = oprsOperatorTone(pstn.operator, input.toneMap);
      const brand = oprsNetworkLabel(tone);
      network =
        brand || (input.labelUnpainted ? OPRS_EXTERNAL_NETWORK : "");
      fillTone = tone;
    }

    return {
      dateDisplay: row.dateDisplay,
      bNumberRaw: row.bNumberRaw,
      callType,
      direction: tariff.direction,
      charge: tariff.charge,
      network,
      operator: pstn.operator,
      geography: pstn.geography,
      fillTone,
    };
  });
}
