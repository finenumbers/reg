import { statusTableExport } from "@/modules/table-export/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/purchased-numbers/export/:id — progress for the owner. */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return statusTableExport("purchased", request, id);
}
