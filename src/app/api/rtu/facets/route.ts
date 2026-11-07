import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { listRtuFacets } from "@/modules/rtu/service";

/**
 * GET /api/rtu/facets — one column, other filters applied.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const column = url.searchParams.get("column")?.trim() ?? "";
  if (!column) {
    return NextResponse.json(
      { error: "column is required", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const phoneQ = url.searchParams.get("phoneQ") ?? undefined;
  const blockedOnly = flagParam(url, "blockedOnly");
  const unregisteredOnly = flagParam(url, "unregisteredOnly");
  const missingOnly = flagParam(url, "missingOnly");
  const q = url.searchParams.get("q") ?? undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200;

  const data = await listRtuFacets({
    column,
    filters,
    phoneQ,
    blockedOnly,
    unregisteredOnly,
    missingOnly,
    q,
    limit,
  });

  return NextResponse.json(data);
}

function flagParam(url: URL, name: string): boolean {
  const value = url.searchParams.get(name);
  return value === "1" || value === "true";
}
