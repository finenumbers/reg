import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import {
  isDockerBridgeDevice,
  openSyslogDownload,
  streamDownload,
} from "@/modules/smg-syslog/browse";
import { syslogNodeExists } from "@/modules/smg-syslog/nodes";
import { syslogRoot } from "@/modules/smg-syslog/paths";

export const runtime = "nodejs";

/**
 * GET /api/smg/syslog/file — snapshot of one 10-minute interval.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const device = url.searchParams.get("device") ?? "";
  if (!isDockerBridgeDevice(device) && !(await syslogNodeExists(device))) {
    return NextResponse.json(
      { error: "Узел не найден", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  const download = openSyslogDownload(syslogRoot(), device, {
    year: url.searchParams.get("year") ?? "",
    month: url.searchParams.get("month") ?? "",
    day: url.searchParams.get("day") ?? "",
    hour: url.searchParams.get("hour") ?? "",
    slot: url.searchParams.get("slot") ?? "",
  });
  if (!download) {
    return NextResponse.json(
      { error: "Файл не найден", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  const opened = streamDownload(download);
  const web = Readable.toWeb(opened.stream) as ReadableStream<Uint8Array>;
  const headers: Record<string, string> = {
    "Content-Type": opened.contentType,
    "Content-Disposition": `attachment; filename="${opened.filename}"`,
    "Cache-Control": "no-store",
  };
  if (opened.size != null) headers["Content-Length"] = String(opened.size);
  return new NextResponse(web, { status: 200, headers });
}
