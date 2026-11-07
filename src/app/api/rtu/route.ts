import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { clampPage, clampPageSize } from "@/modules/rtu/paging";
import { listRtu } from "@/modules/rtu/service";

/**
 * GET /api/rtu — catalog projection. Session or phones:read key.
 * Optional: filters=<json>, phoneQ, blockedOnly, unregisteredOnly, missingOnly, page, pageSize.
 * cursorNumber and cursorId together replace the offset. page stays for key clients.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const phoneQ = url.searchParams.get("phoneQ") ?? undefined;
  const blockedOnly = flagParam(url, "blockedOnly");
  const unregisteredOnly = flagParam(url, "unregisteredOnly");
  const missingOnly = flagParam(url, "missingOnly");
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");
  const cursorNumber = url.searchParams.get("cursorNumber") ?? undefined;
  const cursorId = url.searchParams.get("cursorId") ?? undefined;

  const data = await listRtu({
    filters,
    phoneQ,
    blockedOnly,
    unregisteredOnly,
    missingOnly,
    page: clampPage(page),
    pageSize: clampPageSize(Number.isFinite(pageSize) ? pageSize : undefined),
    cursorNumber,
    cursorId,
  });

  return NextResponse.json(data);
}

function flagParam(url: URL, name: string): boolean {
  const value = url.searchParams.get(name);
  return value === "1" || value === "true";
}
