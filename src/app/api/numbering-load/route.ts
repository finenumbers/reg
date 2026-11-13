import { putSipoutKey } from "@/modules/numbering-load/http";

/** PUT /api/numbering-load — replace the SipOut key. Session only. */
export async function PUT(request: Request) {
  return putSipoutKey(request);
}
