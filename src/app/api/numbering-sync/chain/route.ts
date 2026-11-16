import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { startNumberingChain } from "@/modules/numbering-chain/run";
import { getChainView } from "@/modules/numbering-chain/view";

/** GET /api/numbering-sync/chain — chain and mask progress. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ chain: getChainView() });
}

/** POST /api/numbering-sync/chain — start the full numbering chain. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startNumberingChain({ userId: actor.userId, ip: actor.ip });
  const chain = getChainView();
  if (!result.ok) return numberingSyncJson({ error: result.error, chain }, 409);
  return numberingSyncJson({ ok: true, chain });
}
