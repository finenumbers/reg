import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { XLSX_CONTENT_TYPE, xlsxContentDisposition } from "@/lib/xlsx-export";
import { requireApiPermission } from "@/modules/auth/guards";
import { writeSmgExport } from "@/modules/smg/service";
import {
  endSmgExport,
  smgExportFilename,
  SmgExportTooLargeError,
  tryBeginSmgExport,
  type SmgExportLayout,
} from "@/modules/smg/xlsx-export";
import { cdrVacuumBusyResponse } from "@/modules/storage/vacuum/http";
import { parseMonthKey } from "@/modules/traffic/cdr-month";

export const runtime = "nodejs";

function exportLayout(value: string | null): SmgExportLayout | null {
  if (value === "calls" || value === "traffic") return value;
  return null;
}

/**
 * GET /api/smg/export — xlsx of the current SMG selection.
 * `layout=calls` is every CDR column. `layout=traffic` is the short table, then the rest.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;
  const busy = cdrVacuumBusyResponse();
  if (busy) return busy;

  const url = new URL(request.url);
  const layout = exportLayout(url.searchParams.get("layout"));
  if (!layout) {
    return NextResponse.json(
      { error: "Не указан состав файла", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const month = parseMonthKey(url.searchParams.get("month"));
  if (!month) {
    return NextResponse.json(
      { error: "Некорректный месяц", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const device = url.searchParams.get("device")?.trim() ?? "";
  const phoneQ = url.searchParams.get("phoneQ") ?? "";
  const filters = parseFiltersParam(url.searchParams.get("filters"));

  if (!tryBeginSmgExport()) {
    return NextResponse.json(
      { error: "Дождитесь окончания выгрузки", code: "CONFLICT" },
      { status: 409 },
    );
  }

  let dir: string | null = null;
  try {
    dir = await mkdtemp(path.join(tmpdir(), "smg-xlsx-"));
    const filePath = path.join(dir, "output.xlsx");
    await writeSmgExport({ month, device, phoneQ, filters, layout, filePath });
    const buffer = await readFile(filePath);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": xlsxContentDisposition(
          smgExportFilename(layout, month.key, device),
        ),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof SmgExportTooLargeError) {
      return NextResponse.json(
        { error: error.message, code: "BAD_REQUEST" },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "Не удалось сформировать XLSX";
    return NextResponse.json({ error: message, code: "EXPORT_FAILED" }, { status: 500 });
  } finally {
    endSmgExport();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
