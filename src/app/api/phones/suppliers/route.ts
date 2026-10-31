import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { importPhoneSuppliers } from "@/modules/phones/supplier-import";
import { parseSupplierXlsx } from "@/modules/phones/supplier-xlsx";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/phones/suppliers — fill «Поставщик» and «Категория» on matching numbers.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("phones:request");
  if (!gate.ok) return gate.response;
  if (gate.ctx.authKind === "api_key") {
    return NextResponse.json(
      { error: "API keys cannot upload suppliers", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error: "Файл поставщиков не прочитан",
        details: ["Не удалось прочитать тело запроса (ожидается multipart)"],
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      {
        error: "Файл поставщиков не прочитан",
        details: ["Не передан файл (поле file)"],
      },
      { status: 400 },
    );
  }
  if (file.size <= 0) {
    return NextResponse.json(
      {
        error: "Файл поставщиков не прочитан",
        details: ["Загружен пустой файл"],
      },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: "Файл поставщиков не прочитан",
        details: [`Файл слишком большой. Максимум ${MAX_BYTES} байт`],
      },
      { status: 400 },
    );
  }

  const parsed = await parseSupplierXlsx(Buffer.from(await file.arrayBuffer()));
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, details: parsed.details },
      { status: 400 },
    );
  }

  const result = await importPhoneSuppliers(parsed.rows);
  await auditService.append({
    actorUserId: userId,
    action: AUDIT_ACTIONS.PHONES_SUPPLIERS_IMPORT,
    entityType: "phone_endpoint",
    meta: {
      filename: file.name,
      rows: parsed.rows.length,
      updated: result.updated,
      cleared: result.cleared,
      categoryUpdated: result.categoryUpdated,
      categoryCleared: result.categoryCleared,
      unmatched: result.unmatched,
    },
  });

  return NextResponse.json(result);
}
