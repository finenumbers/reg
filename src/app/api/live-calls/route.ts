import { NextResponse } from "next/server";
import { requireApiSession } from "@/modules/auth/guards";
import { loadRtuSoapAccount } from "@/modules/rtu-soap/credentials";
import { readLiveCalls } from "@/modules/live-calls/snapshot";
import { hasPermission } from "@/modules/rbac/permissions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/live-calls — one shared snapshot of the two transit-call tables.
 * Session only. No query parameters are read. Nothing is written to the switch.
 */
export async function GET() {
  const gate = await requireApiSession();
  if (!gate.ok) return gate.response;
  if (!hasPermission(gate.ctx.authz.permissions, "phones:read")) {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const account = await loadRtuSoapAccount();
  if (!account.ok) {
    return NextResponse.json({
      rows: null,
      takenAt: null,
      refreshInMs: 3000,
      truncated: false,
      error:
        account.code === "DECRYPT_FAILED"
          ? "Не удалось прочитать сохранённый пароль"
          : "Сначала сохраните URL, логин и пароль",
    });
  }

  const payload = await readLiveCalls({
    now: () => Date.now(),
    account,
  });
  return NextResponse.json(payload);
}
