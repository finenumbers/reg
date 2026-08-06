import { NextResponse } from "next/server";
import { checkLiveness } from "@/modules/health/service";

/** Liveness — process is up (no dependency checks). */
export async function GET() {
  return NextResponse.json(checkLiveness());
}
