import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { requireVatsUser } from "@/modules/vats/http";
import { checkVatsAccess } from "@/modules/vats/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;
  const gate = await requireVatsUser("vats:write");
  if (!gate.ok) return gate.response;
  try {
    const result = await checkVatsAccess();
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ count: result.count });
  } catch {
    return NextResponse.json({ error: "Доступ не подтверждён." }, { status: 500 });
  }
}
