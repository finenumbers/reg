import { activeTableExport } from "@/modules/table-export/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/free-numbers/export/active — this user's open build, if any. */
export function GET(request: Request) {
  return activeTableExport("free", request);
}
