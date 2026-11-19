import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getExolveSyncView } from "@/modules/exolve/service";

/** GET /api/numbering-sync/exolve — MTS Exolve stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getExolveSyncView() });
}
