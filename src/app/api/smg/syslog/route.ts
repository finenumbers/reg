import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { listSyslogLevel } from "@/modules/smg-syslog/browse";
import { listSyslogNodes, syslogNodeExists } from "@/modules/smg-syslog/nodes";
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { readStatus } from "@/modules/smg-syslog/status";

export const runtime = "nodejs";

/**
 * GET /api/smg/syslog — registered nodes and one folder level.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const device = url.searchParams.get("device") ?? "";
  const devices = await listSyslogNodes();
  const status = readStatus(syslogRoot());
  if (!device) {
    return NextResponse.json({ devices, list: null, status });
  }
  if (!(await syslogNodeExists(device))) {
    return NextResponse.json({ error: "Узел не найден", code: "NOT_FOUND" }, { status: 404 });
  }
  const list = listSyslogLevel(syslogRoot(), device, {
    year: url.searchParams.get("year") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    day: url.searchParams.get("day") ?? undefined,
    hour: url.searchParams.get("hour") ?? undefined,
  });
  if (!list) {
    return NextResponse.json({ error: "Некорректный путь", code: "BAD_REQUEST" }, { status: 400 });
  }
  return NextResponse.json({ devices, list, status });
}
