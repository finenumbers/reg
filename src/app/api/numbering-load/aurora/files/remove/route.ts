import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { deleteAuroraLink, getAuroraLoadView } from "@/modules/aurora/service";

export const runtime = "nodejs";

/** POST /api/numbering-load/aurora/files/remove — drop one saved CSV. Session only. */
export async function POST(request: Request) {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return numberingLoadJson({ error: "Некорректный запрос." }, 400);
  }
  const id = body && typeof body === "object" && "id" in body ? body.id : null;
  if (typeof id !== "string" || id.length < 8 || id.length > 80) {
    return numberingLoadJson({ error: "Файл уже удалён." }, 400);
  }
  try {
    const removed = await deleteAuroraLink(id, { userId: actor.userId, ip: actor.ip });
    if (!removed.ok) {
      return numberingLoadJson(
        { error: removed.error, settings: await getAuroraLoadView() },
        409,
      );
    }
    return numberingLoadJson({ settings: removed.settings });
  } catch {
    return numberingLoadJson({ error: "Не удалось удалить файл." }, 500);
  }
}
