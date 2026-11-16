import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { cancelNumberingChain } from "@/modules/numbering-chain/run";
import { getChainView } from "@/modules/numbering-chain/view";

/** POST /api/numbering-sync/chain/cancel — stop the chain after the current read. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await cancelNumberingChain();
  const chain = getChainView();
  if (!result.ok) return numberingSyncJson({ error: result.error, chain }, 409);
  return numberingSyncJson({ ok: true, chain });
}
