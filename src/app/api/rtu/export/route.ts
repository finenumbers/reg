import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { buildRtuExportXlsx } from "@/modules/rtu/xlsx-export";
import { XLSX_CONTENT_TYPE, xlsxContentDisposition } from "@/lib/xlsx-export";

/**
 * GET /api/rtu/export — full catalog as XLSX.
 */
export async function GET() {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;
  if (gate.ctx.authKind === "api_key") {
    return NextResponse.json(
      { error: "API keys cannot download this file", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  try {
    const { buffer, filename } = await buildRtuExportXlsx();
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
    return NextResponse.json({ error: message, code: "EXPORT_FAILED" }, { status: 500 });
  }
}
