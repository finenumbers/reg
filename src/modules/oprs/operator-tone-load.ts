/**
 * One process cache of registry operator names for the four OPRS INNs.
 * The CDR list does not wait on a cold registry: a slow read keeps the
 * previous map, or none, and fills the cache when it returns.
 */

import { logger } from "@/lib/logger";
import { EMPTY_NUMBERING_FILTERS } from "@/modules/numbering-resource/filters";
import { listNumberingFacets } from "@/modules/numbering-resource/service";
import {
  OPRS_OPERATOR_INNS,
  oprsToneMap,
  type OprsOperatorTone,
  type OprsOperatorToneMap,
} from "@/modules/oprs/operator-tone";

const TTL_MS = 10 * 60 * 1000;
const BUDGET_MS = 2_000;

type Cache = { at: number; map: OprsOperatorToneMap };

let cache: Cache | null = null;
let pending: Promise<OprsOperatorToneMap> | null = null;

async function readGroup(tone: OprsOperatorTone) {
  const facets = await listNumberingFacets(
    {
      column: "operator",
      q: "",
      filters: { ...EMPTY_NUMBERING_FILTERS, inn: [OPRS_OPERATOR_INNS[tone]] },
    },
    { timeoutMs: BUDGET_MS },
  );
  return {
    tone,
    names: facets.items.map((item) => item.value),
    truncated: facets.truncated,
  };
}

async function readToneMap(): Promise<OprsOperatorToneMap> {
  const tones = Object.keys(OPRS_OPERATOR_INNS) as OprsOperatorTone[];
  const groups = await Promise.all(tones.map((tone) => readGroup(tone)));
  return oprsToneMap(groups);
}

export function resetOprsOperatorToneCache(): void {
  cache = null;
  pending = null;
}

/** Fresh cache, else the map that arrives within the budget, else the last map. */
export async function loadOprsOperatorToneMap(now = Date.now()): Promise<OprsOperatorToneMap> {
  if (cache && now - cache.at < TTL_MS) return cache.map;
  if (!pending) {
    pending = readToneMap()
      .then((map) => {
        cache = { at: Date.now(), map };
        return map;
      })
      .catch((error: unknown) => {
        logger.warn("oprs.operator_tone.unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
        return cache?.map ?? {};
      })
      .finally(() => {
        pending = null;
      });
  }
  const flight = pending;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<OprsOperatorToneMap>((resolve) => {
    timer = setTimeout(() => resolve(cache?.map ?? {}), BUDGET_MS);
  });
  try {
    return await Promise.race([flight, budget]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
