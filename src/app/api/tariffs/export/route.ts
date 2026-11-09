import { NextResponse } from "next/server";
import { XLSX_CONTENT_TYPE, xlsxContentDisposition } from "@/lib/xlsx-export";
import { requireTariffSession } from "@/modules/tariffs/guard";
import { buildTariffExportXlsx } from "@/modules/tariffs/xlsx-export";

/**
 * GET /api/tariffs/export — full tariff snapshot as XLSX.
 * Session + phones:read. API keys are rejected. Does not rate calls.
 */
export async function GET() {
  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  try {
    const { buffer, filename } = await buildTariffExportXlsx();
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
