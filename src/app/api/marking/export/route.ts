import { NextResponse } from "next/server";
import { XLSX_CONTENT_TYPE, xlsxContentDisposition } from "@/lib/xlsx-export";
import { markingApplyHttpError } from "@/modules/marking/apply";
import { mapMarkingReadError } from "@/modules/marking/service";
import { buildMarkingExportXlsx } from "@/modules/marking/xlsx-export";
import { requireTariffSession } from "@/modules/tariffs/guard";

/**
 * GET /api/marking/export — the whole working set as XLSX.
 * Session + phones:read. API keys are rejected.
 * Column filters are not applied: a partial file fails the import.
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
    const mapped = mapMarkingReadError(error) ?? markingApplyHttpError(error);
    if (mapped) {
      return NextResponse.json({ error: mapped.error, code: "EXPORT_FAILED" }, { status: mapped.status });
    }
    const message =
      error instanceof Error ? error.message : "Не удалось сформировать XLSX";
    return NextResponse.json({ error: message, code: "EXPORT_FAILED" }, { status: 500 });
  }
}
