import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { requireApiPermission } from "@/modules/auth/guards";
import { convertRtuXlsxToCsv } from "@/modules/phones/rtu-import";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MiB

/**
 * POST /api/phones/rtu-import
 * Ephemeral: multipart file → CSV download. Nothing persisted.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error: "Файл XLSX не подходит для импорта в РТУ",
        details: ["Не удалось прочитать тело запроса (ожидается multipart)"],
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      {
        error: "Файл XLSX не подходит для импорта в РТУ",
        details: ["Не передан файл (поле file)"],
      },
      { status: 400 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json(
      {
        error: "Файл XLSX не подходит для импорта в РТУ",
        details: ["Загружен пустой файл"],
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: "Файл XLSX не подходит для импорта в РТУ",
        details: [
          `Файл слишком большой (${file.size} байт). Максимум ${MAX_BYTES} байт`,
        ],
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await convertRtuXlsxToCsv(buffer);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: 400 },
    );
  }

  const filename = "import-rtu.csv";
  return new NextResponse(result.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Rtu-Endpoint-Count": String(result.endpointCount),
      "X-Rtu-Gateway-Count": String(result.gatewayCount),
    },
  });
}
