import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import {
  addSyslogNode,
  listSyslogNodes,
  readSyslogEnabled,
  setSyslogEnabled,
  SyslogNodeError,
} from "@/modules/smg-syslog/nodes";
import { syslogAdvertisePort, syslogRoot } from "@/modules/smg-syslog/paths";
import { readStatus } from "@/modules/smg-syslog/status";

export const runtime = "nodejs";

const enableSchema = z.object({ enabled: z.boolean() });

function nodeError(error: SyslogNodeError) {
  const status =
    error.code === "NOT_FOUND" ? 404 : error.code === "DUPLICATE" ? 409 : 400;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

async function sessionUser(gate: { ctx: Parameters<typeof requireSessionUserId>[0] }) {
  try {
    return requireSessionUserId(gate.ctx);
  } catch {
    return null;
  }
}

/**
 * GET /api/settings/smg-syslog — nodes, switch, and receiver status.
 * PATCH /api/settings/smg-syslog — turn the receiver on or off.
 */
export async function GET() {
  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;
  const [enabled, nodes] = await Promise.all([readSyslogEnabled(), listSyslogNodes()]);
  return NextResponse.json(
    {
      enabled,
      advertisePort: syslogAdvertisePort(),
      nodes,
      status: readStatus(syslogRoot()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;
  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;
  const userId = await sessionUser(gate);
  if (!userId) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const parsed = enableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Некорректный запрос", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const enabled = await setSyslogEnabled({
    enabled: parsed.data.enabled,
    actorUserId: userId,
    ip: await getRequestIp(),
  });
  return NextResponse.json({ enabled });
}

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;
  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;
  const userId = await sessionUser(gate);
  if (!userId) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
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
      ip: z.string(),
      name: z.string(),
      identifier: z.string(),
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
    const node = await addSyslogNode({
      ip: parsed.data.ip,
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
