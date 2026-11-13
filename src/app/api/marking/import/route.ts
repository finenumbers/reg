import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit/service";
import { applyMarkingLabels, markingApplyHttpError } from "@/modules/marking/apply";
import {
  MARKING_PARSE_ERROR,
  parseMarkingXlsx,
  sanitizeMarkingFilename,
} from "@/modules/marking/parse-xlsx";
import { requireTariffSession } from "@/modules/tariffs/guard";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/marking/import — replace marking and MAV cells for the live number set.
 * The file's phones must equal that set. Session + phones:read. API keys cannot call this.
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
        error: MARKING_PARSE_ERROR,
        details: ["Не удалось прочитать тело запроса (ожидается multipart)"],
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      {
        error: MARKING_PARSE_ERROR,
        details: ["Не передан файл (поле file)"],
      },
      { status: 400 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json(
      {
        error: MARKING_PARSE_ERROR,
        details: ["Загружен пустой файл"],
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: MARKING_PARSE_ERROR,
        details: [`Файл слишком большой (${file.size} байт). Максимум ${MAX_BYTES} байт`],
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseMarkingXlsx(buffer);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, details: parsed.details },
      { status: 400 },
    );
  }

  const filename = sanitizeMarkingFilename(file.name);
  let applied: Awaited<ReturnType<typeof applyMarkingLabels>>;
  try {
    applied = await applyMarkingLabels(parsed.rows, filename);
  } catch (error) {
    const mapped = markingApplyHttpError(error);
    if (mapped) {
      return NextResponse.json(
        { error: mapped.error, details: mapped.details },
        { status: mapped.status },
      );
    }
    throw error;
  }

  await auditService.append({
    actorUserId: gate.ctx.session.user.id,
    action: AUDIT_ACTIONS.MARKING_IMPORT,
    entityType: "marking_import",
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
