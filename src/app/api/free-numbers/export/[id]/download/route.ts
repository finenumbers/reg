import { downloadTableExport } from "@/modules/table-export/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/free-numbers/export/:id/download — stream the finished file. */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return downloadTableExport("free", request, id);
}
