import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { startNumberingChain } from "@/modules/numbering-chain/run";
import { readSyncScreen } from "@/modules/numbering-chain/screen";

/** GET /api/numbering-sync/chain — chain, next run, and parsed counters. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson(await readSyncScreen());
}

/** POST /api/numbering-sync/chain — start the full numbering chain. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startNumberingChain({ userId: actor.userId, ip: actor.ip });
  const screen = await readSyncScreen();
  if (!result.ok) return numberingSyncJson({ error: result.error, ...screen }, 409);
  return numberingSyncJson({ ok: true, ...screen });
}
