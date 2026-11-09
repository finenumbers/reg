import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { requireVatsUser } from "@/modules/vats/http";
import { refreshVatsTelnums } from "@/modules/vats/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;
  const gate = await requireVatsUser("vats:read");
  if (!gate.ok) return gate.response;
  try {
    const result = await refreshVatsTelnums(gate.userId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      names: result.names,
      readAt: result.readAt,
      notice: result.notice,
    });
  } catch {
    return NextResponse.json({ error: "Не удалось обновить список." }, { status: 500 });
  }
}
