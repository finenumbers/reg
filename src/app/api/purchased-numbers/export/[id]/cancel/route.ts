import { cancelTableExport } from "@/modules/table-export/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/purchased-numbers/export/:id/cancel — stop a build or drop a finished file. */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return cancelTableExport("purchased", request, id);
}
