/**
 * Tariff routes are session-only. API keys carry phones:read and must not
 * read or replace the snapshot.
 */

import { NextResponse } from "next/server";
import { requireApiSession } from "@/modules/auth/guards";
import type { SessionAuthzContext } from "@/modules/auth/session";
import { hasPermission } from "@/modules/rbac/permissions";

type GateOk = { ok: true; ctx: SessionAuthzContext };
type GateFail = { ok: false; response: NextResponse };

export async function requireTariffSession(): Promise<GateOk | GateFail> {
  const gate = await requireApiSession();
  if (!gate.ok) return gate;
  if (!hasPermission(gate.ctx.authz.permissions, "phones:read")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403 },
      ),
    };
  }
  return gate;
}
