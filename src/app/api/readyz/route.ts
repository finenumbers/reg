import { NextResponse } from "next/server";
import { checkReadiness } from "@/modules/health/service";

/** Readiness — env valid + DB reachable. */
export async function GET() {
  const result = await checkReadiness();
  if (result.status === "ready") {
    return NextResponse.json(result);
  }

  const isProd = process.env.NODE_ENV === "production";
  return NextResponse.json(
    {
      status: result.status,
      checks: result.checks,
      ...(isProd ? {} : { detail: result.detail }),
      ...(isProd ? { error: "not ready" } : {}),
    },
    { status: 503 },
  );
}
