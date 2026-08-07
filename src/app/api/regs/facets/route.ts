import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { listRegistrationFacets } from "@/modules/registrations/service";
import { REG_COLUMN_HEADERS } from "@/modules/registrations/ui-format";

/**
 * GET /api/regs/facets — distinct values + counts for one column (cross-filter aware).
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("regs:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const column = url.searchParams.get("column")?.trim() ?? "";
  if (!column || !(column in REG_COLUMN_HEADERS)) {
    return NextResponse.json(
      { error: "Invalid or missing column", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const phoneQ = url.searchParams.get("phoneQ") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200;

  const data = await listRegistrationFacets({
    column,
    filters,
    phoneQ,
    q,
    limit,
  });

  return NextResponse.json(data);
}
