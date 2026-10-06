import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit/service";
import { applyTariffSnapshot } from "@/modules/tariffs/apply";
import { requireTariffSession } from "@/modules/tariffs/guard";
import { parseTariffXlsx, sanitizeTariffFilename } from "@/modules/tariffs/parse-xlsx";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/tariffs/import — replace the tariff snapshot from an XLSX file.
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
        error: "Файл не подходит для тарификации",
        details: ["Не удалось прочитать тело запроса (ожидается multipart)"],
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      {
        error: "Файл не подходит для тарификации",
        details: ["Не передан файл (поле file)"],
      },
      { status: 400 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json(
      {
        error: "Файл не подходит для тарификации",
        details: ["Загружен пустой файл"],
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: "Файл не подходит для тарификации",
        details: [`Файл слишком большой (${file.size} байт). Максимум ${MAX_BYTES} байт`],
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseTariffXlsx(buffer);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, details: parsed.details },
      { status: 400 },
    );
  }

  const filename = sanitizeTariffFilename(file.name);
  const applied = await applyTariffSnapshot(parsed.rows, filename);

  await auditService.append({
    actorUserId: gate.ctx.session.user.id,
    action: AUDIT_ACTIONS.TARIFFS_IMPORT,
    entityType: "tariff_import",
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
