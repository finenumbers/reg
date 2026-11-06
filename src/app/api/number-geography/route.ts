import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { clampPage, clampPageSize } from "@/modules/number-geography/paging";
import { listNumberGeography } from "@/modules/number-geography/service";

/**
 * GET /api/number-geography — catalog projection. Session or phones:read key.
 * Optional: filters=<json>, phoneQ, blockedOnly, page, pageSize.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const phoneQ = url.searchParams.get("phoneQ") ?? undefined;
  const blockedOnly =
    url.searchParams.get("blockedOnly") === "1" ||
    url.searchParams.get("blockedOnly") === "true";
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");

  const data = await listNumberGeography({
    filters,
    phoneQ,
    blockedOnly,
    page: clampPage(page),
    pageSize: clampPageSize(Number.isFinite(pageSize) ? pageSize : undefined),
  });

  return NextResponse.json(data);
}
