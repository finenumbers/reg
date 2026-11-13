import { NextResponse } from "next/server";
import { XLSX_CONTENT_TYPE, xlsxContentDisposition } from "@/lib/xlsx-export";
import { buildMarkingExportXlsx } from "@/modules/marking/xlsx-export";
import { requireTariffSession } from "@/modules/tariffs/guard";

/**
 * GET /api/marking/export — full marking snapshot as XLSX.
 * Session + phones:read. API keys are rejected.
 * Column filters are not applied: a filtered file would replace the catalog on import.
 */
export async function GET() {
  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  try {
    const { buffer, filename } = await buildMarkingExportXlsx();
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
