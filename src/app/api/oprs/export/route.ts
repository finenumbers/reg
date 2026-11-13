import { NextResponse } from "next/server";
import type { ColumnFilters } from "@/components/column-filters/types";
import { assertSameOrigin } from "@/lib/csrf";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { beginOprsExportJob } from "@/modules/oprs/export-job";
import { OprsQueryError, resolveOprsSnapshot } from "@/modules/oprs/where";
import { cdrVacuumBusyResponse } from "@/modules/storage/vacuum/http";
import { parseMonthKey } from "@/modules/traffic/cdr-month";
import type { TrafficRowFlags } from "@/modules/traffic/row-flags";
import { parseTimeSort } from "@/modules/traffic/traffic-sort";

export const runtime = "nodejs";

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

function flag(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function flagsFrom(record: Record<string, unknown>): TrafficRowFlags {
  return {
    phantom: flag(record, "phantom"),
    callErrors: flag(record, "callErrors"),
    parking: flag(record, "parking"),
    failed: flag(record, "failed"),
    check: flag(record, "check"),
    success: flag(record, "success"),
  };
}

/**
 * POST /api/oprs/export — xlsx of the snapshot currently open in the table.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;
  const busy = cdrVacuumBusyResponse();
  if (busy) return busy;

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

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
  const month = parseMonthKey(typeof record.month === "string" ? record.month : null);
  if (!month) {
    return NextResponse.json(
      { error: "Некорректный месяц", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  let snapshot: Date;
  try {
    snapshot = resolveOprsSnapshot(
      typeof record.snapshot === "string" ? record.snapshot : null,
      new Date(),
    );
  } catch (error) {
    if (error instanceof OprsQueryError) {
      return NextResponse.json(
        { error: error.message, code: "BAD_REQUEST" },
        { status: 400 },
      );
    }
    throw error;
  }
  const started = beginOprsExportJob({
    month,
    phoneQ: typeof record.phoneQ === "string" ? record.phoneQ : "",
    filters: readFilters(record.filters),
    flags: flagsFrom(record),
    timeSort: parseTimeSort(typeof record.timeSort === "string" ? record.timeSort : null),
    snapshot,
    actorUserId: userId,
  });
  if (started === "busy") {
    return NextResponse.json(
      { error: "Дождитесь окончания выгрузки", code: "CONFLICT" },
      { status: 409 },
    );
  }
  return NextResponse.json({ job: started });
}
