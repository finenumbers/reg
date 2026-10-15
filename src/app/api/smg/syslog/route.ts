import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import {
  isDockerBridgeDevice,
  listSyslogCascade,
  listSyslogPurgeMonths,
  readSyslogStoredBytes,
  withBridgeDevices,
} from "@/modules/smg-syslog/browse";
import { canonicalIpv4 } from "@/modules/smg-syslog/ip";
import { syslogNodeLabels } from "@/modules/smg-syslog/identifier";
import { listSyslogNodes, syslogNodeExists } from "@/modules/smg-syslog/nodes";
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { readStatus } from "@/modules/smg-syslog/status";

export const runtime = "nodejs";

/**
 * GET /api/smg/syslog — registered nodes and the cascade for one device.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const device = url.searchParams.get("device") ?? "";
  const root = syslogRoot();
  const devices = withBridgeDevices(syslogNodeLabels(await listSyslogNodes()), root);
  const status = readStatus(root);
  if (!device) {
    return NextResponse.json({
      devices,
      cascade: null,
      purgeMonths: [],
      lastPacket: null,
      storedBytes: null,
      status,
    });
  }
  if (!isDockerBridgeDevice(device) && !(await syslogNodeExists(device))) {
    return NextResponse.json(
      { error: "Узел не найден", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  const requested = {
    year: url.searchParams.get("year") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    day: url.searchParams.get("day") ?? undefined,
    hour: url.searchParams.get("hour") ?? undefined,
  };
  const now = new Date();
  const cascade = listSyslogCascade(root, device, requested);
  const purgeMonths = listSyslogPurgeMonths(root, device, now);
  if (!cascade || !purgeMonths) {
    return NextResponse.json(
      { error: "Некорректный путь", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const canonical = canonicalIpv4(device);
  const lastPacket = canonical ? (status?.lastPacket[canonical] ?? null) : null;
  const storedBytes = await readSyslogStoredBytes(root, device);
  return NextResponse.json({
    devices,
    cascade,
    purgeMonths,
    lastPacket,
    storedBytes,
    status,
  });
}
