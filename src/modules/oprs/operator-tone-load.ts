/**
 * One process cache of registry operator names for the OPRS color INNs.
 * The CDR list does not wait on a cold registry: a slow read keeps the
 * previous map, or none, and fills the cache when it returns.
 * Statistics waits for that same read. It does not start a second one.
 */

import { logger } from "@/lib/logger";
import { EMPTY_NUMBERING_FILTERS } from "@/modules/numbering-resource/filters";
import { listNumberingFacets } from "@/modules/numbering-resource/service";
import {
  OPRS_OPERATOR_INNS,
  oprsToneReport,
  oprsUnpaintedLabelEnabled,
  type OprsOperatorTone,
  type OprsOperatorToneMap,
} from "@/modules/oprs/operator-tone";

const TTL_MS = 10 * 60 * 1000;
const BUDGET_MS = 2_000;

export type OprsToneLoad = {
  map: OprsOperatorToneMap;
  labelUnpainted: boolean;
};

const EMPTY_LOAD: OprsToneLoad = { map: {}, labelUnpainted: false };

type Cache = { at: number; load: OprsToneLoad };

let cache: Cache | null = null;
let pending: Promise<OprsToneLoad> | null = null;

async function readGroup(tone: OprsOperatorTone) {
  const facets = await listNumberingFacets(
    {
      column: "operator",
      q: "",
      filters: { ...EMPTY_NUMBERING_FILTERS, inn: [...OPRS_OPERATOR_INNS[tone]] },
    },
    { timeoutMs: BUDGET_MS },
  );
  return {
    tone,
    names: facets.items.map((item) => item.value),
    truncated: facets.truncated,
  };
}

async function readToneLoad(): Promise<OprsToneLoad> {
  const tones = Object.keys(OPRS_OPERATOR_INNS) as OprsOperatorTone[];
  const groups = await Promise.all(tones.map((tone) => readGroup(tone)));
  const report = oprsToneReport(groups);
  if (report.truncated.length > 0) {
    logger.warn("oprs.operator_tone.truncated", { tones: report.truncated });
  }
  if (report.conflicts.length > 0) {
    logger.warn("oprs.operator_tone.conflict", { names: report.conflicts });
  }
  const counts: Record<OprsOperatorTone, number> = {
    green: 0,
    red: 0,
    yellow: 0,
    gray: 0,
  };
  for (const tone of Object.values(report.map)) {
    if (tone) counts[tone] += 1;
  }
  logger.info("oprs.operator_tone.loaded", { counts });
  return {
    map: report.map,
    labelUnpainted: oprsUnpaintedLabelEnabled(report),
  };
}

function startRead(): Promise<OprsToneLoad> {
  if (!pending) {
    pending = readToneLoad()
      .then((load) => {
        cache = { at: Date.now(), load };
        return load;
      })
      .catch((error: unknown) => {
        logger.warn("oprs.operator_tone.unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
        return cache?.load ?? EMPTY_LOAD;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/**
 * Fresh cache, else the load that arrives within the budget, else the last load.
 * `wait` skips the budget and uses the in-flight registry read.
 */
export async function loadOprsToneReport(
  now = Date.now(),
  opts: { wait?: boolean } = {},
): Promise<OprsToneLoad> {
  if (cache && now - cache.at < TTL_MS) return cache.load;
  const flight = startRead();
  if (opts.wait) return flight;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<OprsToneLoad>((resolve) => {
    timer = setTimeout(() => resolve(cache?.load ?? EMPTY_LOAD), BUDGET_MS);
  });
  try {
    return await Promise.race([flight, budget]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Fresh cache, else the map that arrives within the budget, else the last map. */
export async function loadOprsOperatorToneMap(
  now = Date.now(),
): Promise<OprsOperatorToneMap> {
  return (await loadOprsToneReport(now)).map;
}

export function resetOprsOperatorToneCache(): void {
  cache = null;
  pending = null;
}
