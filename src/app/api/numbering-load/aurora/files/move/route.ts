import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { getAuroraLoadView, reorderAuroraLink } from "@/modules/aurora/service";

export const runtime = "nodejs";

/** POST /api/numbering-load/aurora/files/move — change the read order. Session only. */
export async function POST(request: Request) {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return numberingLoadJson({ error: "Некорректный запрос." }, 400);
  }
  const record = body && typeof body === "object" ? body : null;
  const id = record && "id" in record ? record.id : null;
  const direction = record && "direction" in record ? record.direction : null;
  if (typeof id !== "string" || (direction !== "up" && direction !== "down")) {
    return numberingLoadJson({ error: "Некорректный запрос." }, 400);
  }
  try {
    const moved = await reorderAuroraLink(id, direction);
    if (!moved.ok) {
      return numberingLoadJson(
        { error: moved.error, settings: await getAuroraLoadView() },
        409,
      );
    }
    return numberingLoadJson({ settings: moved.settings });
  } catch {
    return numberingLoadJson({ error: "Не удалось изменить порядок." }, 500);
  }
}
