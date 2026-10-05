import { NextResponse } from "next/server";
import { requireApiSession } from "@/modules/auth/guards";
import { readDatabaseBytes } from "@/modules/db-size/service";

/** GET /api/db-size — on-disk size of the project database. */
export async function GET() {
  const gate = await requireApiSession();
  if (!gate.ok) return gate.response;

  const bytes = await readDatabaseBytes();
  return NextResponse.json({ bytes });
}
