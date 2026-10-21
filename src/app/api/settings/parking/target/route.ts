import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireSessionUserId } from "@/modules/auth/session";
import { drainParkingCalls } from "@/modules/antifraud/ingest";
import { updateParkingTarget } from "@/modules/antifraud/secret";
import { ParkingTargetError } from "@/modules/antifraud/target";

/** PUT /api/settings/parking/target — host, user, and log path. Never returns key material. */
export async function PUT(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (
    !record ||
    typeof record.host !== "string" ||
    typeof record.username !== "string" ||
    typeof record.logPath !== "string"
  ) {
    return NextResponse.json(
      { error: "Некорректный адрес, имя или путь", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  try {
    const ip = await getRequestIp();
    const status = await updateParkingTarget(
      { host: record.host, username: record.username, logPath: record.logPath },
      { userId, ip },
    );
    if (status.configured) void drainParkingCalls();
    return NextResponse.json({ status });
  } catch (error) {
    if (error instanceof ParkingTargetError) {
      return NextResponse.json(
        { error: error.message, code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
    throw error;
  }
}
