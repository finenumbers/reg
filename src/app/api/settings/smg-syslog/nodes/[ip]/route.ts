import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { isDockerBridgeDevice } from "@/modules/smg-syslog/browse";
import { canonicalIpv4 } from "@/modules/smg-syslog/ip";
import {
  deleteSyslogNode,
  findSyslogNode,
  renameSyslogNode,
  SyslogNodeError,
} from "@/modules/smg-syslog/nodes";
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { eraseSyslogNode } from "@/modules/smg-syslog/purge";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ ip: string }> };

function nodeError(error: SyslogNodeError) {
  const status =
    error.code === "NOT_FOUND" ? 404 : error.code === "DUPLICATE" ? 409 : 400;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

/**
 * PATCH /api/settings/smg-syslog/nodes/:ip — rename. The address stays.
 * DELETE /api/settings/smg-syslog/nodes/:ip — stop accepting that source and delete its files.
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
    return NextResponse.json(
      { error: "Invalid JSON body", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const parsed = z
    .object({
      name: z.string(),
      identifier: z.string().optional(),
      cdrTimezone: z.string().optional(),
      antifraudEnabled: z.boolean().optional(),
    })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Некорректный запрос", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  try {
    const node = await renameSyslogNode({
      ip: decodeURIComponent(ip),
      name: parsed.data.name,
      identifier: parsed.data.identifier,
      cdrTimezone: parsed.data.cdrTimezone,
      antifraudEnabled: parsed.data.antifraudEnabled,
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
  const { ip: rawIp } = await context.params;
  const ip = canonicalIpv4(decodeURIComponent(rawIp));
  if (!ip) {
    return NextResponse.json(
      { error: "Узел не найден", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  const requestIp = await getRequestIp();
  const result = await eraseSyslogNode({
    root: syslogRoot(),
    ip,
    bridge: isDockerBridgeDevice(ip),
    loadNode: () => findSyslogNode(ip),
    deleteNode: async () => {
      try {
        return await deleteSyslogNode(ip);
      } catch (error) {
        if (error instanceof SyslogNodeError && error.code === "NOT_FOUND") return null;
        throw error;
      }
    },
  });
  if (result.ok || result.code === "REMAINS" || result.code === "RECREATED") {
    await auditService.append({
      actorUserId: userId,
      action: AUDIT_ACTIONS.SMG_SYSLOG_NODE_DELETE,
      entityType: "smg_syslog_node",
      entityId: ip,
      ip: requestIp,
      meta: {
        ip,
        name: result.node?.name ?? null,
        identifier: result.node?.identifier ?? null,
        filesRemoved: result.filesRemoved,
        leftover: result.ok ? result.leftover : false,
      },
    });
  }
  if (result.ok) return NextResponse.json({ ok: true });
  const status =
    result.code === "NOT_FOUND"
      ? 404
      : result.code === "RECREATED"
        ? 409
        : result.code === "REMAINS"
          ? 500
          : 400;
  return NextResponse.json(
    {
      error: result.message,
      code: result.code === "REMAINS" ? "FILES_REMAIN" : result.code,
    },
    { status },
  );
}
