import { NextResponse } from "next/server";
import { requireVatsUser } from "@/modules/vats/http";
import { getVatsDomainPage, getVatsTelnumPage } from "@/modules/vats/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requireVatsUser("vats:read");
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const section = url.searchParams.get("section");
  const offset = Number(url.searchParams.get("offset"));
  if (
    (section !== "domains" && section !== "telnums") ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  ) {
    return NextResponse.json({ error: "Недопустимый запрос." }, { status: 400 });
  }
  try {
    const page =
      section === "domains"
        ? await getVatsDomainPage(offset)
        : await getVatsTelnumPage(offset);
    return NextResponse.json({ rows: page.rows, total: page.total });
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать строки." }, { status: 500 });
  }
}
