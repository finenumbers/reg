import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { listMarkingRows, mapMarkingReadError } from "@/modules/marking/service";
import { requireTariffSession } from "@/modules/tariffs/guard";

/**
 * GET /api/marking — one page of the live working set. Session + phones:read.
 * API keys are rejected. Further pages pass `cursor`, the last full number.
 */
export async function GET(request: Request) {
  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");
  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const cursor = url.searchParams.get("cursor");

  try {
    const data = await listMarkingRows({
      pageSize: Number.isFinite(pageSize) ? pageSize : 100,
      filters,
      cursor,
    });
    return NextResponse.json(data);
  } catch (error) {
    const mapped = mapMarkingReadError(error);
    if (mapped) {
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    throw error;
  }
}
