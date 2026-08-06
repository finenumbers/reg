import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { getRegistrationDetail } from "@/modules/registrations/service";

type RouteContext = { params: Promise<{ phone: string }> };

/**
 * GET /api/regs/[phone] — current state + change history for one phone.
 * Protected with regs:read.
 */
export async function GET(_request: Request, context: RouteContext) {
  const gate = await requireApiPermission("regs:read");
  if (!gate.ok) return gate.response;

  const { phone: rawPhone } = await context.params;
  const phone = decodeURIComponent(rawPhone ?? "").trim();
  if (!phone) {
    return NextResponse.json(
      { error: "Phone is required", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const detail = await getRegistrationDetail(phone);
  if (!detail) {
    return NextResponse.json(
      { error: "Registration not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  return NextResponse.json(detail);
}
