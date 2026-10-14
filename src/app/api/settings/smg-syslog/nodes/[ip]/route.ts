import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { deleteSyslogNode, renameSyslogNode, SyslogNodeError } from "@/modules/smg-syslog/nodes";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ ip: string }> };

function nodeError(error: SyslogNodeError) {
  const status = error.code === "NOT_FOUND" ? 404 : error.code === "DUPLICATE" ? 409 : 400;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

/**
 * PATCH /api/settings/smg-syslog/nodes/:ip — rename. The address stays.
 * DELETE /api/settings/smg-syslog/nodes/:ip — stop accepting that source.
 */
export async function PATCH(request: Request, context: RouteContext) {
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
  const { ip } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, { status: 400 });
  }
  const parsed = z.object({ name: z.string() }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный запрос", code: "BAD_REQUEST" }, { status: 400 });
  }
  try {
    const node = await renameSyslogNode({
      ip: decodeURIComponent(ip),
      name: parsed.data.name,
      actorUserId: userId,
      requestIp: await getRequestIp(),
    });
    return NextResponse.json({ node });
  } catch (error) {
    if (error instanceof SyslogNodeError) return nodeError(error);
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
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
  const { ip } = await context.params;
  try {
    await deleteSyslogNode({
      ip: decodeURIComponent(ip),
      actorUserId: userId,
      requestIp: await getRequestIp(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SyslogNodeError) return nodeError(error);
    throw error;
  }
}
