import {
  numberingSyncActor,
  numberingSyncError,
  numberingSyncJson,
} from "@/modules/numbering-sync/http";
import { sipoutKeySaveSchema } from "@/modules/numbering-sync/schemas";
import { getNumberingSyncView, saveSipoutKey } from "@/modules/numbering-sync/service";

/** GET /api/numbering-sync — host, key flag, and walk status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const settings = await getNumberingSyncView();
  return numberingSyncJson({ settings });
}

/** PUT /api/numbering-sync — replace the SipOut key. Session only. */
export async function PUT(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return numberingSyncJson({ error: "Некорректный запрос." }, 400);
  }
  try {
    const input = sipoutKeySaveSchema.parse(body);
    const settings = await saveSipoutKey(input.token, {
      userId: actor.userId,
      ip: actor.ip,
    });
    return numberingSyncJson({ settings });
  } catch (error) {
    return numberingSyncError(error);
  }
}
