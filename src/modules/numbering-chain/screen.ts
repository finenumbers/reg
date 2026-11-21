/**
 * One row for the sync page poll. The chain view stays in memory.
 * Parsed counters are one read of numbering_catalog_state.
 * An old pass name counts rows at the cursor, then later polls read the row.
 */

import { prisma } from "@/lib/db";
import { applyParsedView } from "@/modules/numbering-catalog/parsed-pass";
import type { ChainView } from "@/modules/numbering-chain/order";
import { getChainView } from "@/modules/numbering-chain/view";
import {
  asCardInt,
  emptyParsed,
  nextChainLabel,
  type ParsedSnapshot,
  type ProviderKey,
} from "@/modules/numbering-sync/card-numbers";
import { getDisplayTimezone } from "@/modules/settings/service";

export type SyncScreen = {
  chain: ChainView;
  nextRunLabel: string;
  parsed: ParsedSnapshot;
};

const COLUMNS: readonly {
  key: ProviderKey;
  epoch: string;
  done: string;
  parsed: string;
}[] = [
  { key: "sipout", epoch: "sipout_epoch", done: "sipout_done", parsed: "sipout_parsed" },
  {
    key: "runexis",
    epoch: "runexis_epoch",
    done: "runexis_done",
    parsed: "runexis_parsed",
  },
  { key: "uis", epoch: "uis_epoch", done: "uis_done", parsed: "uis_parsed" },
  {
    key: "aurora",
    epoch: "aurora_epoch",
    done: "aurora_done",
    parsed: "aurora_parsed",
  },
  { key: "exolve", epoch: "exolve_epoch", done: "exolve_done", parsed: "exolve_parsed" },
  {
    key: "voximplant",
    epoch: "voximplant_epoch",
    done: "voximplant_done",
    parsed: "voximplant_parsed",
  },
  { key: "mcn", epoch: "mcn_epoch", done: "mcn_done", parsed: "mcn_parsed" },
  {
    key: "finenumbers",
    epoch: "finenumbers_epoch",
    done: "finenumbers_done",
    parsed: "finenumbers_parsed",
  },
];

async function readParsedSnapshot(): Promise<ParsedSnapshot> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT
      mask_epoch, mask_done,
      resplit_epoch, resplit_done,
      sipout_epoch, sipout_done, sipout_parsed,
      runexis_epoch, runexis_done, runexis_parsed,
      uis_epoch, uis_done, uis_parsed,
      aurora_epoch, aurora_done, aurora_parsed,
      exolve_epoch, exolve_done, exolve_parsed,
      voximplant_epoch, voximplant_done, voximplant_parsed,
      mcn_epoch, mcn_done, mcn_parsed,
      finenumbers_epoch, finenumbers_done, finenumbers_parsed,
      cursor_phase, cursor_after, cursor_epoch, cursor_provider, parsed_pass
    FROM numbering_catalog_state
    WHERE id = 1
  `;
  const row = rows[0];
  if (!row) return emptyParsed();
  const snapshot = emptyParsed();
  snapshot.maskEpoch = asCardInt(row.mask_epoch);
  snapshot.maskDone = asCardInt(row.mask_done);
  for (const column of COLUMNS) {
    snapshot.providers[column.key] = {
      epoch: asCardInt(row[column.epoch]),
      done: asCardInt(row[column.done]),
      parsed: asCardInt(row[column.parsed]),
    };
  }
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return applyParsedView(snapshot, {
    resplitEpoch: asCardInt(row.resplit_epoch),
    resplitDone: asCardInt(row.resplit_done),
    cursorPhase: text(row.cursor_phase),
    cursorAfter: text(row.cursor_after),
    cursorEpoch: asCardInt(row.cursor_epoch),
    cursorProvider: text(row.cursor_provider),
    parsedPass: text(row.parsed_pass),
  });
}

export async function readSyncScreen(now = new Date()): Promise<SyncScreen> {
  const [timeZone, parsed] = await Promise.all([
    getDisplayTimezone(),
    readParsedSnapshot(),
  ]);
  return {
    chain: getChainView(),
    nextRunLabel: nextChainLabel(now, timeZone),
    parsed,
  };
}
