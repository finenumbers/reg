import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit/service";
import { applyMaskSnapshot } from "@/modules/masks/apply";
import { parseMaskXlsx, sanitizeMaskFilename } from "@/modules/masks/parse-xlsx";
import { requireTariffSession } from "@/modules/tariffs/guard";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;
const PARSE_ERROR = "Файл не подходит для масок и типов";

/**
 * POST /api/masks/import — replace the mask snapshot from an XLSX file.
 * Session + phones:read. API keys cannot call this.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error: PARSE_ERROR,
        details: ["Не удалось прочитать тело запроса (ожидается multipart)"],
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      {
        error: PARSE_ERROR,
        details: ["Не передан файл (поле file)"],
      },
      { status: 400 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json(
      {
        error: PARSE_ERROR,
        details: ["Загружен пустой файл"],
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: PARSE_ERROR,
        details: [`Файл слишком большой (${file.size} байт). Максимум ${MAX_BYTES} байт`],
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseMaskXlsx(buffer);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, details: parsed.details },
      { status: 400 },
    );
  }

  const filename = sanitizeMaskFilename(file.name);
  const applied = await applyMaskSnapshot(parsed.rows, filename);

  await auditService.append({
    actorUserId: gate.ctx.session.user.id,
    action: AUDIT_ACTIONS.MASKS_IMPORT,
    entityType: "number_mask_import",
    entityId: "1",
    meta: { filename, rowCount: applied.rowCount },
    ip: await getRequestIp(),
  });

  return NextResponse.json({
    rowCount: applied.rowCount,
    loadedAt: applied.loadedAt.toISOString(),
    filename,
  });
}
