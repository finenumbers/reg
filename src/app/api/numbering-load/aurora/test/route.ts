import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { checkAuroraLinks } from "@/modules/aurora/service";

export const runtime = "nodejs";

/** POST /api/numbering-load/aurora/test — parse the saved files. Session only. */
export async function POST(request: Request) {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  try {
    const checked = await checkAuroraLinks(
      { userId: actor.userId, ip: actor.ip },
      request.signal,
    );
    if (!checked.ok) return numberingLoadJson({ error: checked.error }, 400);
    return numberingLoadJson(checked);
  } catch {
    return numberingLoadJson({ error: "Не удалось разобрать файлы." }, 500);
  }
}
