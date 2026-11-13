import { putNumberingSource } from "@/modules/numbering-load/http";
import { savePurchasedNumberSource } from "@/modules/numbering-load/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/numbering-load/purchased — origin and optional token. Session only. */
export function PUT(request: Request) {
  return putNumberingSource(request, savePurchasedNumberSource);
}
