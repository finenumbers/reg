/**
 * Rate one cost-estimate input sheet into output rows.
 */

import { MISSING_PSTN_LABEL, billableMinutes } from "@/modules/enrich/types";
import { OPRS_EXTERNAL_NETWORK, oprsNetworkLabel } from "@/modules/oprs/derived";
import { oprsOperatorTone } from "@/modules/oprs/operator-tone";
import type { OprsOperatorToneMap } from "@/modules/oprs/operator-tone";
import { classifyCostEstimateType } from "@/modules/cost-estimate/classify";
import { secondsToElapsedMsString } from "@/modules/cost-estimate/normalize";
import { shownCostEstimateRegion } from "@/modules/cost-estimate/region";
import {
  COST_ESTIMATE_EMPTY_NETWORK,
  COST_ESTIMATE_LOCAL_CHARGE,
  type CostEstimateInputRow,
  type CostEstimateOutputRow,
  type CostEstimatePstnFields,
} from "@/modules/cost-estimate/types";
import { formatTariffDecimal } from "@/modules/tariffs/parse-xlsx";
import {
  CALL_CATEGORY,
  CALL_STATUS,
  CALL_TYPE,
} from "@/modules/traffic/call-class";
import {
  rateCdrCall,
  type TariffRateLookup,
} from "@/modules/traffic/cdr-tariff";
import { matchTariffAbc } from "@/modules/traffic/tariff-match";

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

function catalogUnitPrice(matched: TariffRateLookup | null): string {
  const raw = matched?.price?.trim() ?? "";
  if (!raw) return "";
  return formatTariffDecimal(raw);
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
    const matched = matchTariffAbc(row.bDigits, input.rates);
    const price = catalogUnitPrice(matched);
    const tariffRegion = matched?.region?.trim() ?? "";
    const pstn = input.pstn.get(row.bDigits) ?? {
      operator: "",
      geography: "",
    };

    const registryMissing = isCostEstimateRegistryMissing(
      callType,
      pstn.operator,
    );
    const region = shownCostEstimateRegion({
      callType,
      direction: tariff.direction,
      tariffRegion,
      pstnGeography: pstn.geography,
      registryMissing,
    });

    if (registryMissing) {
      return {
        dateDisplay: row.dateDisplay,
        aNumberRaw: row.aNumberRaw,
        bNumberRaw: row.bNumberRaw,
        callType,
        direction: tariff.direction,
        region,
        seconds: row.seconds,
        minutes: billableMinutes(row.seconds),
        price,
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
    } else if (!network) {
      network = COST_ESTIMATE_EMPTY_NETWORK;
    }

    return {
      dateDisplay: row.dateDisplay,
      aNumberRaw: row.aNumberRaw,
      bNumberRaw: row.bNumberRaw,
      callType,
      direction: tariff.direction,
      region,
      seconds: row.seconds,
      minutes: billableMinutes(row.seconds),
      price,
      charge: chargeForRow(callType, tariff.charge),
      network,
      operator: pstn.operator,
      geography: pstn.geography,
      fillTone,
      registryMissing: false,
    };
  });
}
