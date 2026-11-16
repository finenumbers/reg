import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { AURORA_URL_LIMIT } from "@/modules/aurora/url";
import { isAuroraFormat } from "@/modules/aurora/parse";
import { getAuroraLoadView, saveAuroraLink } from "@/modules/aurora/service";

export const runtime = "nodejs";

/** POST /api/numbering-load/aurora/files — store one link. Session only. The body is not fetched. */
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
  const url = record && "url" in record ? record.url : null;
  const format = record && "format" in record ? record.format : null;
  if (typeof format !== "string" || !isAuroraFormat(format)) {
    return numberingLoadJson(
      { error: "Укажите формат файла.", settings: await getAuroraLoadView() },
      400,
    );
  }
  if (typeof url !== "string" || url.length > AURORA_URL_LIMIT) {
    return numberingLoadJson(
      { error: "Укажите ссылку https.", settings: await getAuroraLoadView() },
      400,
    );
  }
  try {
    const saved = await saveAuroraLink({ url, format }, { userId: actor.userId, ip: actor.ip });
    if (!saved.ok) {
      return numberingLoadJson(
        { error: saved.error, settings: await getAuroraLoadView() },
        400,
      );
    }
    return numberingLoadJson({ settings: saved.settings });
  } catch {
    return numberingLoadJson(
      { error: "Не удалось сохранить ссылку.", settings: await getAuroraLoadView() },
      500,
    );
  }
}
