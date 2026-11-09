import { NextResponse } from "next/server";
import { requireVatsUser } from "@/modules/vats/http";
import { getVatsStatus } from "@/modules/vats/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireVatsUser("vats:read");
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json(await getVatsStatus());
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать состояние." },
      { status: 500 },
    );
  }
}
