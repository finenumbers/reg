import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { listRegistrations } from "@/modules/registrations/service";
import type { RegStatus } from "@/generated/prisma/client";

/**
 * GET /api/regs — list current registration states from local DB.
 * Optional: filters=<json ColumnFilters>, legacy status/phone, page, pageSize.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("regs:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const phone = url.searchParams.get("phone") ?? undefined;
  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");

  let status: RegStatus | undefined;
  if (statusParam === "Registered" || statusParam === "Unregistered") {
    status = statusParam;
  } else if (statusParam) {
    return NextResponse.json(
      { error: "Invalid status filter", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const result = await listRegistrations({
    status,
    phone,
    filters,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 100,
  });

  return NextResponse.json(result);
}
