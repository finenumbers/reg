import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { buildPhonesExportXlsx } from "@/modules/phones/xlsx-export";
import {
  XLSX_CONTENT_TYPE,
  xlsxContentDisposition,
} from "@/lib/xlsx-export";

/**
 * GET /api/phones/export — softswitch-format XLSX (Группы / Оконечное / Шлюзы).
 */
export async function GET() {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  try {
    const { buffer, filename } = await buildPhonesExportXlsx();
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": xlsxContentDisposition(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось сформировать XLSX";
    return NextResponse.json(
      { error: message, code: "EXPORT_FAILED" },
      { status: 500 },
    );
  }
}
