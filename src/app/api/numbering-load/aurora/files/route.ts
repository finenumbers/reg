import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { isAuroraFormat } from "@/modules/aurora/parse";
import { displayFileName } from "@/modules/aurora/files";
import { getAuroraLoadView, saveAuroraFile } from "@/modules/aurora/service";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/** POST /api/numbering-load/aurora/files — store one CSV. Session only. */
export async function POST(request: Request) {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return numberingLoadJson({ error: "Не удалось прочитать файл." }, 400);
  }
  const format = form.get("format");
  const file = form.get("file");
  if (typeof format !== "string" || !isAuroraFormat(format)) {
    return numberingLoadJson({ error: "Укажите формат файла.", settings: await getAuroraLoadView() }, 400);
  }
  if (!(file instanceof File)) {
    return numberingLoadJson({ error: "Нужен файл CSV.", settings: await getAuroraLoadView() }, 400);
  }
  if (!displayFileName(file.name)) {
    return numberingLoadJson({ error: "Нужен файл CSV.", settings: await getAuroraLoadView() }, 400);
  }
  if (file.size > MAX_BYTES) {
    return numberingLoadJson({ error: "Файл больше 20 МБ.", settings: await getAuroraLoadView() }, 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const saved = await saveAuroraFile(
      { bytes, displayName: file.name, format },
      { userId: actor.userId, ip: actor.ip },
    );
    if (!saved.ok) {
      return numberingLoadJson(
        { error: saved.error, settings: await getAuroraLoadView() },
        400,
      );
    }
    return numberingLoadJson({ settings: saved.settings, dropped: saved.dropped });
  } catch {
    return numberingLoadJson({ error: "Не удалось сохранить файл.", settings: await getAuroraLoadView() }, 500);
  }
}
