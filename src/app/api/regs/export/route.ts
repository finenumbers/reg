import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { buildRegsExportXlsx } from "@/modules/registrations/xlsx-export";
import {
  XLSX_CONTENT_TYPE,
  xlsxContentDisposition,
} from "@/lib/xlsx-export";

/**
 * GET /api/regs/export — full registrations table as XLSX.
 */
export async function GET() {
  const gate = await requireApiPermission("regs:read");
  if (!gate.ok) return gate.response;

  try {
    const { buffer, filename } = await buildRegsExportXlsx();
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
