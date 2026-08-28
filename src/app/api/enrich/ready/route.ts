import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { getEnrichReadyFlags } from "@/modules/pstn/credentials";

/**
 * GET /api/enrich/ready — whether PSTN/GeoIP keys exist (no secrets).
 */
export async function GET() {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;
  if (gate.ctx.authKind === "api_key") {
    return NextResponse.json(
      { error: "API keys cannot use enrich", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const flags = await getEnrichReadyFlags();
  return NextResponse.json({
    hasPstnApiKey: flags.hasPstnApiKey,
    hasGeoipApiKey: flags.hasGeoipApiKey,
    ready: flags.hasPstnApiKey && flags.hasGeoipApiKey,
  });
}
