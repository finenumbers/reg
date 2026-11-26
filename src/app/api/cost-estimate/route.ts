import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import {
  XLSX_CONTENT_TYPE,
  xlsxContentDisposition,
} from "@/lib/xlsx-export";
import { requireApiPermission } from "@/modules/auth/guards";
import { runCostEstimate } from "@/modules/cost-estimate/run";
import { COST_ESTIMATE_PARSE_ERROR } from "@/modules/cost-estimate/types";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MiB

/**
 * POST /api/cost-estimate
 * Ephemeral: multipart file → rated XLSX. Nothing persisted.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  if (gate.ctx.authKind === "api_key") {
    return NextResponse.json(
      {
        error: "API keys cannot use cost estimate",
        code: "FORBIDDEN",
      },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error: COST_ESTIMATE_PARSE_ERROR,
        details: ["Не удалось прочитать тело запроса (ожидается multipart)"],
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      {
        error: COST_ESTIMATE_PARSE_ERROR,
        details: ["Не передан файл (поле file)"],
      },
      { status: 400 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json(
      {
        error: COST_ESTIMATE_PARSE_ERROR,
        details: ["Загружен пустой файл"],
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: COST_ESTIMATE_PARSE_ERROR,
        details: [
          `Файл слишком большой (${file.size} байт). Максимум ${MAX_BYTES} байт`,
        ],
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await runCostEstimate(buffer);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    );
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": xlsxContentDisposition(result.filename),
      "Cache-Control": "no-store",
      ...(result.pstnSnapshotEmpty
        ? { "X-Cost-Estimate-Pstn-Empty": "1" }
        : {}),
    },
  });
}
