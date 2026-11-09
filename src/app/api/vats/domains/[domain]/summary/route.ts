import { NextResponse } from "next/server";
import { requireVatsUser } from "@/modules/vats/http";
import { getVatsDomainSummary } from "@/modules/vats/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ domain: string }> };

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const gate = await requireVatsUser("vats:read");
  if (!gate.ok) return gate.response;
  const { domain } = await context.params;
  try {
    const result = await getVatsDomainSummary(decodeName(domain));
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ summary: result.summary });
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать домен." }, { status: 500 });
  }
}
