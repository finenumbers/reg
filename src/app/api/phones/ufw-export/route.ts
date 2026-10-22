import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import {
  buildUfwExportXlsx,
  UFW_SKIPPED_REGISTRATION_HEADER,
} from "@/modules/phones/ufw-export";
import {
  XLSX_CONTENT_TYPE,
  xlsxContentDisposition,
} from "@/lib/xlsx-export";

/**
 * GET /api/phones/ufw-export — UFW rule XLSX from DB snapshot (no persistence).
 */
export async function GET() {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  try {
    const { buffer, filename, skippedRegistrationError } = await buildUfwExportXlsx();
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": xlsxContentDisposition(filename),
        "Cache-Control": "no-store",
        [UFW_SKIPPED_REGISTRATION_HEADER]: String(skippedRegistrationError),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось сформировать XLSX";
    return NextResponse.json(
      { error: message, code: "UFW_EXPORT_FAILED" },
      { status: 500 },
    );
  }
}
