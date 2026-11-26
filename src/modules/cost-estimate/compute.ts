/**
 * Rate one cost-estimate input sheet into output rows.
 */

import { MISSING_PSTN_LABEL, billableMinutes } from "@/modules/enrich/types";
import { OPRS_EXTERNAL_NETWORK, oprsNetworkLabel } from "@/modules/oprs/derived";
import { oprsOperatorTone } from "@/modules/oprs/operator-tone";
import type { OprsOperatorToneMap } from "@/modules/oprs/operator-tone";
import { classifyCostEstimateType } from "@/modules/cost-estimate/classify";
import { secondsToElapsedMsString } from "@/modules/cost-estimate/normalize";
import {
  COST_ESTIMATE_LOCAL_CHARGE,
  type CostEstimateInputRow,
  type CostEstimateOutputRow,
  type CostEstimatePstnFields,
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

const DOMESTIC_REGISTRY_TYPES = new Set<string>([
  CALL_TYPE.local,
  CALL_TYPE.mobile,
  CALL_TYPE.intercity,
]);

export function isCostEstimateRegistryMissing(
  callType: string,
  operator: string,
): boolean {
  if (!DOMESTIC_REGISTRY_TYPES.has(callType)) return false;
  const trimmed = operator.trim();
  return !trimmed || trimmed === MISSING_PSTN_LABEL;
}

function chargeForRow(callType: string, tariffCharge: string): string {
  if (callType === CALL_TYPE.local) return COST_ESTIMATE_LOCAL_CHARGE;
  return tariffCharge;
}

export function buildCostEstimateRows(input: {
  rows: readonly CostEstimateInputRow[];
  rates: readonly TariffRateLookup[];
  pstn: ReadonlyMap<string, CostEstimatePstnFields>;
  toneMap: OprsOperatorToneMap;
  labelUnpainted: boolean;
}): CostEstimateOutputRow[] {
  return input.rows.map((row) => {
    const callType = classifyCostEstimateType(
      row.aDigits,
      row.bDigits,
      input.rates,
    );
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

    const registryMissing = isCostEstimateRegistryMissing(
      callType,
      pstn.operator,
    );
    if (registryMissing) {
      return {
        dateDisplay: row.dateDisplay,
        aNumberRaw: row.aNumberRaw,
        bNumberRaw: row.bNumberRaw,
        callType,
        direction: tariff.direction,
        seconds: row.seconds,
        minutes: billableMinutes(row.seconds),
        charge: chargeForRow(callType, ""),
        network: "",
        operator: MISSING_PSTN_LABEL,
        geography: MISSING_PSTN_LABEL,
        fillTone: null,
        registryMissing: true,
      };
    }

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
      aNumberRaw: row.aNumberRaw,
      bNumberRaw: row.bNumberRaw,
      callType,
      direction: tariff.direction,
      seconds: row.seconds,
      minutes: billableMinutes(row.seconds),
      charge: chargeForRow(callType, tariff.charge),
      network,
      operator: pstn.operator,
      geography: pstn.geography,
      fillTone,
      registryMissing: false,
    };
  });
}
