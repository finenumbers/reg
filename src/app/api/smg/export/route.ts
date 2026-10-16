import { NextResponse } from "next/server";
import type { ColumnFilters } from "@/components/column-filters/types";
import { assertSameOrigin } from "@/lib/csrf";
import { requireApiPermission } from "@/modules/auth/guards";
import { beginSmgExportJob } from "@/modules/smg/export-job";
import type { SmgExportLayout } from "@/modules/smg/xlsx-export";
import { cdrVacuumBusyResponse } from "@/modules/storage/vacuum/http";
import { parseMonthKey } from "@/modules/traffic/cdr-month";

export const runtime = "nodejs";

function exportLayout(value: unknown): SmgExportLayout | null {
  if (value === "calls" || value === "traffic") return value;
  return null;
}

function readFilters(value: unknown): ColumnFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const filters: ColumnFilters = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!Array.isArray(raw)) continue;
    const values = raw.filter((item): item is string => typeof item === "string");
    if (values.length > 0) filters[key] = values;
  }
  return filters;
}

/**
 * POST /api/smg/export — start an xlsx build and return before the file exists.
 * The browser polls GET /api/smg/export/:id and then downloads the finished file.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;
  const busy = cdrVacuumBusyResponse();
  if (busy) return busy;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Некорректное тело запроса", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const layout = exportLayout(record.layout);
  if (!layout) {
    return NextResponse.json(
      { error: "Не указан состав файла", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const month = parseMonthKey(typeof record.month === "string" ? record.month : null);
  if (!month) {
    return NextResponse.json(
      { error: "Некорректный месяц", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const device = typeof record.device === "string" ? record.device.trim() : "";
  const phoneQ = typeof record.phoneQ === "string" ? record.phoneQ : "";
  const started = beginSmgExportJob({
    month,
    device,
    phoneQ,
    filters: readFilters(record.filters),
    layout,
  });
  if (started === "busy") {
    return NextResponse.json(
      { error: "Дождитесь окончания выгрузки", code: "CONFLICT" },
      { status: 409 },
    );
  }
  return NextResponse.json({ job: started });
}
