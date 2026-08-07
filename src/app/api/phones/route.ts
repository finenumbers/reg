import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { listPhones } from "@/modules/phones/service";
import { parsePhoneKind } from "@/modules/phones/types";

/**
 * GET /api/phones — list phone gateways or endpoint registration buckets from local DB.
 * Optional: filters=<json>, phoneQ, sipUnregisteredOnly, page, pageSize.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const kind = parsePhoneKind(url.searchParams.get("kind"));
  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const phoneQ = url.searchParams.get("phoneQ") ?? undefined;
  const sipUnregisteredOnly =
    url.searchParams.get("sipUnregisteredOnly") === "1" ||
    url.searchParams.get("sipUnregisteredOnly") === "true";
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");

  const data = await listPhones({
    kind,
    filters,
    phoneQ,
    sipUnregisteredOnly,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 100,
  });

  return NextResponse.json(data);
}
